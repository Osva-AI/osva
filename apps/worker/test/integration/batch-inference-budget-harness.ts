import { randomUUID } from "node:crypto";
import type {
  BatchInferenceItemId,
  InferenceBudgetPeriodKeyV1,
  WorkspaceId,
} from "@osva-ai/contracts";
import { createDefaultInferenceBudgetPolicyDefinition } from "@osva-ai/contracts";
import { resolveInferenceBudgetUtcPeriodIdentity } from "@osva/domain";
import type {
  BatchInferenceJobId,
  BatchInferenceProviderJobStatus,
} from "@osva-ai/contracts";
import {
  PostgresBatchInferenceJobRepository,
  PostgresInferenceBudgetAdmissionRepository,
  PostgresInferenceBudgetPolicyRepository,
  PostgresWorkspaceBatchInferencePolicyRepository,
  type Database,
} from "@osva/db";
import type { BatchInferenceJobRepository } from "@osva/domain";
import type { InferenceBudgetAdmissionPort } from "@osva-ai/contracts";
import { ProcessEnvSecretResolver } from "@osva/adapters-runtime-http";

import { createBatchInferenceWorkerBundle } from "../../src/create-batch-inference-worker.js";
import { fetchJson } from "./integration-auth.js";

export const BATCH_BUDGET_WS = "ws-batch-budget" as WorkspaceId;
export const BATCH_BUDGET_WS_B = "ws-batch-budget-b" as WorkspaceId;

export function currentBatchPeriodKey(): InferenceBudgetPeriodKeyV1 {
  return resolveInferenceBudgetUtcPeriodIdentity(new Date())
    .periodKey as InferenceBudgetPeriodKeyV1;
}

export async function enableBatchInference(
  database: Database,
  workspaceId: WorkspaceId,
): Promise<void> {
  const policies = new PostgresWorkspaceBatchInferencePolicyRepository(
    database,
  );
  await policies.upsertPolicy(workspaceId, {
    batchInferenceEnabled: true,
    denySensitiveWorkloads: true,
  });
}

export async function seedWorkspaceInferenceBudget(
  database: Database,
  input: {
    readonly workspaceId: WorkspaceId;
    readonly periodLimitUsdMicros: number;
    readonly enabled: boolean;
    readonly now: Date;
  },
): Promise<void> {
  const policyId = randomUUID();
  const versionId = randomUUID();
  const policies = new PostgresInferenceBudgetPolicyRepository(database);
  await policies.savePolicy({
    id: policyId as never,
    workspaceId: input.workspaceId,
    key: "default",
    createdAt: input.now,
  });
  await policies.savePolicyVersion({
    id: versionId as never,
    policyId: policyId as never,
    workspaceId: input.workspaceId,
    version: 1,
    definition: {
      ...createDefaultInferenceBudgetPolicyDefinition(),
      periodLimitUsdMicros: input.periodLimitUsdMicros,
    },
    createdAt: input.now,
  });
  if (input.enabled) {
    await policies.upsertWorkspaceActivation({
      workspaceId: input.workspaceId,
      enabled: true,
      activePolicyVersionId: versionId as never,
      updatedAt: input.now,
    });
  }
}

/** Test-only: force local markSubmitted to fail after provider accept. */
export class TestBatchJobsDenyMarkSubmitted extends PostgresBatchInferenceJobRepository {
  constructor(database: Database) {
    super(database);
  }

  override async markSubmitted(
    jobId: BatchInferenceJobId,
    input: {
      readonly providerBatchId: string;
      readonly providerJobStatus: BatchInferenceProviderJobStatus;
      readonly reconcileAfterAt: Date;
    },
  ): Promise<boolean> {
    void jobId;
    void input;
    return false;
  }
}

/** Test-only: inject provider-start persistence failure before submit. */
export class TestAdmissionFailProviderStart extends PostgresInferenceBudgetAdmissionRepository {
  constructor(database: Database) {
    super(database);
  }

  override async markProviderStarted(
    ...args: Parameters<InferenceBudgetAdmissionPort["markProviderStarted"]>
  ): Promise<
    Awaited<ReturnType<InferenceBudgetAdmissionPort["markProviderStarted"]>>
  > {
    void args;
    throw new Error("test_provider_start_persistence_failure");
  }
}

export function createBudgetedBatchBundle(input: {
  readonly database: Database;
  readonly workerId?: string;
  readonly now?: () => Date;
  readonly jobs?: BatchInferenceJobRepository;
  readonly inferenceBudgetAdmission?: InferenceBudgetAdmissionPort;
}) {
  const policies = new PostgresInferenceBudgetPolicyRepository(input.database);
  const admission =
    input.inferenceBudgetAdmission ??
    new PostgresInferenceBudgetAdmissionRepository(input.database);
  return createBatchInferenceWorkerBundle({
    database: input.database,
    secretResolver: new ProcessEnvSecretResolver({
      OPENAI_API_KEY: "test-key",
    }),
    clock: { now: input.now ?? (() => new Date()) },
    batchLimit: 10,
    workerId: input.workerId,
    jobs: input.jobs,
    inferenceBudgetPolicies: policies,
    inferenceBudgetAdmission:
      admission as PostgresInferenceBudgetAdmissionRepository,
  });
}

export async function seedOpenAiBatchBinding(
  origin: string,
  fakeOrigin: string,
): Promise<{
  modelProfileVersionId: string;
  providerConnectionVersionId: string;
}> {
  const connection = await fetchJson(
    `${origin}/v1/model-provider-connections`,
    {
      method: "POST",
      body: {
        key: "openai-batch",
        name: "OpenAI batch",
        provider: "OPENAI",
      },
    },
  );
  if (connection.status !== 201) {
    throw new Error("connection create failed");
  }
  const connectionId = (connection.body as { id: string }).id;
  const connectionVersion = await fetchJson(
    `${origin}/v1/model-provider-connections/${connectionId}/versions`,
    {
      method: "POST",
      body: {
        endpoint: {
          baseUrl: `${fakeOrigin}/v1`,
          allowPrivateNetworks: true,
        },
        credentialRef: { key: "OPENAI_API_KEY" },
      },
    },
  );
  if (connectionVersion.status !== 201) {
    throw new Error("connection version create failed");
  }
  const providerConnectionVersionId = (connectionVersion.body as { id: string })
    .id;

  const profile = await fetchJson(`${origin}/v1/model-profiles`, {
    method: "POST",
    body: { key: "batch", name: "Batch model" },
  });
  const modelProfileId = (profile.body as { id: string }).id;
  const version = await fetchJson(
    `${origin}/v1/model-profiles/${modelProfileId}/versions`,
    {
      method: "POST",
      body: {
        provider: "OPENAI",
        model: "gpt-4o-mini",
        modelProviderConnectionVersionId: providerConnectionVersionId,
        pricing: {
          currency: "USD",
          inputUsdMicrosPerMillionTokens: 1_000_000,
          outputUsdMicrosPerMillionTokens: 2_000_000,
        },
      },
    },
  );
  if (version.status !== 201) {
    throw new Error("model profile version create failed");
  }
  return {
    modelProfileVersionId: (version.body as { id: string }).id,
    providerConnectionVersionId,
  };
}

export function buildBatchCreateBody(input: {
  readonly workspaceId: WorkspaceId;
  readonly modelProfileVersionId: string;
  readonly providerConnectionVersionId: string;
  readonly fingerprint: string;
  readonly items: Array<{ providerCorrelationId: string; content: string }>;
}) {
  return {
    workspaceId: input.workspaceId,
    submissionFingerprint: input.fingerprint,
    modelProfileVersionId: input.modelProfileVersionId,
    providerConnectionVersionId: input.providerConnectionVersionId,
    items: input.items.map((item) => ({
      itemId: randomUUID() as BatchInferenceItemId,
      providerCorrelationId: item.providerCorrelationId,
      input: {
        messages: [{ role: "user" as const, content: item.content }],
        maxOutputTokens: 64,
      },
    })),
  };
}

export async function listBudgetReservations(
  database: Database,
  workspaceId: WorkspaceId,
): Promise<
  Array<{
    status: string;
    reservation_key: string;
    reserved_usd_micros: number;
    committed_usd_micros: number | null;
    provider_started_at: Date | null;
    period_key: string;
  }>
> {
  const rows = await database.sql`
    SELECT status, reservation_key, reserved_usd_micros, committed_usd_micros,
           provider_started_at, period_key
    FROM inference_budget_reservations
    WHERE workspace_id = ${workspaceId}
    ORDER BY created_at
  `;
  return rows as typeof rows;
}

export async function waitUntil(
  check: () => Promise<boolean>,
  deadlineMs = 45_000,
): Promise<void> {
  const deadline = Date.now() + deadlineMs;
  while (Date.now() < deadline) {
    if (await check()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("waitUntil timed out");
}

export async function readBatchJob(
  database: Database,
  jobId: string,
): Promise<Record<string, unknown> | undefined> {
  const rows = await database.sql`
    SELECT id, submission_fingerprint, request_material_hash, status,
           reconciliation_required, reconciliation_note, provider_batch_id
    FROM batch_inference_jobs
    WHERE id = ${jobId}
    LIMIT 1
  `;
  return rows[0] as Record<string, unknown> | undefined;
}

export async function makeBatchJobDue(
  database: Database,
  jobId: string,
  at: Date,
): Promise<void> {
  const iso = at.toISOString();
  await database.sql.unsafe(
    `UPDATE batch_inference_jobs
     SET reconcile_after_at = $1::timestamptz, updated_at = $1::timestamptz
     WHERE id = $2`,
    [iso, jobId],
  );
}

export async function setBatchSubmissionLease(
  database: Database,
  jobId: string,
  input: { readonly owner: string; readonly expiresAt: Date },
): Promise<void> {
  await database.sql.unsafe(
    `UPDATE batch_inference_jobs
     SET submission_lease_owner = $1,
         submission_lease_expires_at = $2::timestamptz,
         updated_at = NOW()
     WHERE id = $3`,
    [input.owner, input.expiresAt.toISOString(), jobId],
  );
}

export async function driveBatchProcessorUntilTerminal(input: {
  readonly bundle: ReturnType<typeof createBudgetedBatchBundle>;
  readonly origin: string;
  readonly jobId: string;
  readonly maxTicks?: number;
}): Promise<Record<string, unknown>> {
  const maxTicks = input.maxTicks ?? 40;
  for (let tick = 0; tick < maxTicks; tick += 1) {
    await input.bundle.processor.execute({ batchLimit: 3 });
    const detail = await fetchJson(
      `${input.origin}/v1/batch-inference-jobs/${input.jobId}`,
    );
    if (detail.status === 200) {
      const job = (detail.body as { job: Record<string, unknown> }).job;
      const status = job.status as string;
      if (
        status === "COMPLETED" ||
        status === "PARTIALLY_COMPLETED" ||
        status === "FAILED" ||
        status === "CANCELLED" ||
        status === "EXPIRED" ||
        (status === "SUBMITTING" && job.reconciliationRequired === true)
      ) {
        return job;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error("driveBatchProcessorUntilTerminal timed out");
}

export async function waitForJobTerminal(
  origin: string,
  jobId: string,
  deadlineMs = 60_000,
): Promise<Record<string, unknown>> {
  const started = Date.now();
  for (;;) {
    const detail = await fetchJson(
      `${origin}/v1/batch-inference-jobs/${jobId}`,
    );
    if (detail.status !== 200) {
      throw new Error(`job get failed: ${String(detail.status)}`);
    }
    const job = (detail.body as { job: Record<string, unknown> }).job;
    const status = job.status as string;
    if (
      status === "COMPLETED" ||
      status === "PARTIALLY_COMPLETED" ||
      status === "FAILED" ||
      status === "CANCELLED" ||
      status === "EXPIRED" ||
      (status === "SUBMITTING" && job.reconciliationRequired === true)
    ) {
      return job;
    }
    if (Date.now() - started > deadlineMs) {
      throw new Error(`timeout; last status=${status}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
}
