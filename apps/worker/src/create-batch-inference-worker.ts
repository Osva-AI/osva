import { hostname } from "node:os";

import type {
  InferenceBudgetAdmissionPort,
  SecretResolver,
} from "@osva-ai/contracts";
import type { Database } from "@osva/db";
import {
  PostgresBatchInferenceJobRepository,
  PostgresInferenceBudgetPolicyRepository,
  PostgresModelProfileRepository,
  PostgresModelProviderConnectionRepository,
} from "@osva/db";
import type {
  BatchInferenceJobRecord,
  BatchInferenceJobRepository,
} from "@osva/domain";
import type { OsvaInstrumentation } from "@osva/observability";
import {
  BatchInferenceRecoveryCoordinator,
  ProcessBatchInferenceJobs,
  createOtelBatchInferenceMetrics,
  type BatchInferenceItemBudgetReconcilePort,
  type BatchInferenceSubmitBudgetPort,
} from "@osva/orchestration";
import { createBatchInferenceProviderAdapter } from "./batch-inference-adapter-factory.js";
import {
  admitBatchInferenceSubmitBudget,
  reconcileBatchInferenceItemBudget,
} from "./batch-inference-budget-submit.js";

export interface BatchInferenceWorkerBundle {
  readonly processor: ProcessBatchInferenceJobs;
  readonly coordinator: BatchInferenceRecoveryCoordinator;
}

export function createBatchInferenceWorkerBundle(input: {
  readonly database: Database;
  readonly secretResolver: SecretResolver;
  readonly clock: { now(): Date };
  readonly batchLimit: number;
  readonly workerId?: string;
  readonly instrumentation?: OsvaInstrumentation;
  readonly inferenceBudgetPolicies?: PostgresInferenceBudgetPolicyRepository;
  readonly inferenceBudgetAdmission?: InferenceBudgetAdmissionPort;
  readonly jobs?: BatchInferenceJobRepository;
}): BatchInferenceWorkerBundle {
  const jobs =
    input.jobs ?? new PostgresBatchInferenceJobRepository(input.database);
  const modelProfiles = new PostgresModelProfileRepository(input.database);
  const connections = new PostgresModelProviderConnectionRepository(
    input.database,
  );
  const workerId =
    input.workerId ?? `worker:${hostname()}:${String(process.pid)}:batch`;
  const batchMetrics = createOtelBatchInferenceMetrics(input.instrumentation);

  const resolveAdapter = async (job: BatchInferenceJobRecord) => {
    const version = await modelProfiles.findModelProfileVersionById(
      job.modelProfileVersionId,
    );
    if (version === null) {
      throw new Error("model profile version missing");
    }
    const connectionVersion = await connections.findConnectionVersionById(
      job.providerConnectionVersionId,
    );
    if (connectionVersion === null) {
      throw new Error("provider connection version missing");
    }
    const connection = await connections.findConnectionByWorkspaceAndId(
      job.workspaceId,
      connectionVersion.connectionId,
    );
    if (connection === null) {
      throw new Error("provider connection missing");
    }
    const credentialRef = connectionVersion.credentialRef;
    if (credentialRef === undefined) {
      throw new Error("provider credentials missing");
    }
    const apiKey = await input.secretResolver.resolve(credentialRef);
    const endpoint = connectionVersion.endpoint;
    return createBatchInferenceProviderAdapter({
      provider: version.provider,
      apiKey,
      baseURL: endpoint?.baseUrl,
      timeout: 120_000,
    });
  };

  let submitBudget: BatchInferenceSubmitBudgetPort | undefined;
  let reconcileItemBudget: BatchInferenceItemBudgetReconcilePort | undefined;
  if (
    input.inferenceBudgetAdmission !== undefined &&
    input.inferenceBudgetPolicies !== undefined
  ) {
    const admission = input.inferenceBudgetAdmission;
    const policies = input.inferenceBudgetPolicies;
    submitBudget = {
      admitBeforeSubmit: async ({ job, items }) => {
        const modelProfileVersion =
          await modelProfiles.findModelProfileVersionById(
            job.modelProfileVersionId,
          );
        if (modelProfileVersion === null) {
          return { kind: "DENIED", code: "model_profile_missing" };
        }
        const outcome = await admitBatchInferenceSubmitBudget({
          policies,
          admission,
          job,
          items,
          modelProfileVersion,
          now: input.clock.now(),
        });
        if (outcome.kind === "BYPASS") {
          return { kind: "BYPASS" };
        }
        if (outcome.kind === "DENIED") {
          return outcome;
        }
        return {
          kind: "ADMITTED",
          markAllProviderStartedBeforeSubmit:
            outcome.session.markAllProviderStartedBeforeSubmit,
          rollbackNeverSubmitted: outcome.session.rollbackNeverSubmitted,
          markSubmitUncertain: outcome.session.markSubmitUncertain,
        };
      },
    };
    reconcileItemBudget = {
      reconcileTerminalItem: async (ctx) => {
        await reconcileBatchInferenceItemBudget({
          policies,
          admission,
          job: ctx.job,
          item: ctx.item,
          estimatedCostMicros: ctx.estimatedCostMicros,
          usageKnown: ctx.usageKnown,
          billableProviderOutcome: ctx.billableProviderOutcome,
          cancelled: ctx.cancelled,
        });
      },
    };
  }

  const processor = new ProcessBatchInferenceJobs({
    jobs,
    resolveAdapter,
    loadItems: (jobId) => jobs.listItemsForJob(jobId),
    clock: input.clock,
    workerId,
    batchMetrics,
    submitBudget,
    reconcileItemBudget,
  });

  const coordinator = new BatchInferenceRecoveryCoordinator({
    processor,
    batchLimit: input.batchLimit,
  });

  return { processor, coordinator };
}
