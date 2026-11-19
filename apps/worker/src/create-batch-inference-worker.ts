import { hostname } from "node:os";

import type { SecretResolver } from "@osva-ai/contracts";
import type { Database } from "@osva/db";
import {
  PostgresBatchInferenceJobRepository,
  PostgresModelProfileRepository,
  PostgresModelProviderConnectionRepository,
} from "@osva/db";
import type { BatchInferenceJobRecord } from "@osva/domain";
import type { OsvaInstrumentation } from "@osva/observability";
import {
  BatchInferenceRecoveryCoordinator,
  ProcessBatchInferenceJobs,
  createOtelBatchInferenceMetrics,
} from "@osva/orchestration";
import { createBatchInferenceProviderAdapter } from "./batch-inference-adapter-factory.js";

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
}): BatchInferenceWorkerBundle {
  const jobs = new PostgresBatchInferenceJobRepository(input.database);
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

  const processor = new ProcessBatchInferenceJobs({
    jobs,
    resolveAdapter,
    loadItems: (jobId) => jobs.listItemsForJob(jobId),
    clock: input.clock,
    workerId,
    batchMetrics,
  });

  const coordinator = new BatchInferenceRecoveryCoordinator({
    processor,
    batchLimit: input.batchLimit,
  });

  return { processor, coordinator };
}
