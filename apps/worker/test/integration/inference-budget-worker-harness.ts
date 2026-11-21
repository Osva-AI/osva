import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  ValkeyExactResponseCache,
  createAesGcmWireProtection,
  parseKeyRingFromEnv,
} from "@osva/adapters-inference-cache-valkey";
import { BullMqJobQueue } from "@osva/adapters-bullmq";
import { sha256IntegrityOf } from "@osva/adapters-runtime-typescript";
import type {
  InferenceBudgetPolicyId,
  InferenceBudgetPolicyVersionId,
  InferenceBudgetPeriodKeyV1,
  InferenceResponseCachePolicyV1,
  WorkspaceId,
} from "@osva-ai/contracts";
import { createDefaultInferenceBudgetPolicyDefinition } from "@osva-ai/contracts";
import { resolveInferenceBudgetUtcPeriodIdentity } from "@osva/domain";
import {
  createDatabase,
  PostgresInferenceBudgetPolicyRepository,
  type Database,
} from "@osva/db";

import { withTestAuthEnv } from "../../../../packages/db/test/integration/web-auth-env.js";
import { createWebProcess } from "../../../../apps/web/src/process.js";
import { createWorkerProcess } from "../../src/process.js";
import { fetchJson } from "./integration-auth.js";
import type { PostgresTestContext } from "../../../../packages/db/test/integration/postgres-harness.js";
import type { ValkeyTestContext } from "../../../../adapters/bullmq/test/integration/valkey-harness.js";

export const BUDGET_WORKSPACE = "ws-budget-worker" as WorkspaceId;
export const BUDGET_POLICY_ID = "ibp-worker" as InferenceBudgetPolicyId;
export const BUDGET_POLICY_VERSION_ID =
  "ibpv-worker" as InferenceBudgetPolicyVersionId;

export const FIXTURE_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../adapters/runtime-typescript/test/fixtures",
);

export const TRUSTED_CACHE_POLICY: InferenceResponseCachePolicyV1 = {
  schemaVersion: "1",
  enabled: true,
  determinism: "REQUIRED_DETERMINISTIC",
  ttlSeconds: 3_600,
};

const INTEGRATION_CACHE_KEY_RING = parseKeyRingFromEnv({
  activeKeyId: "integration",
  activeKeyB64: Buffer.alloc(32, 21).toString("base64"),
});

export interface BudgetWorkerStack {
  readonly origin: string;
  readonly worker: Awaited<ReturnType<typeof createWorkerProcess>>;
  readonly web: ReturnType<typeof createWebProcess>;
  readonly inspector: BullMqJobQueue;
  readonly agentId: string;
  readonly agentVersionId: string;
  readonly modelProfileVersionId: string;
  readonly cheapModelProfileVersionId: string;
  readonly connectionVersionId: string;
  readonly createModelVersion: (input: {
    readonly key: string;
    readonly model: string;
    readonly inputUsdMicrosPerMillionTokens?: number;
    readonly modelProviderConnectionVersionId?: string;
  }) => Promise<string>;
  shutdown(): Promise<void>;
}

export async function waitUntil(check: () => Promise<boolean>): Promise<void> {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (await check()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error("waitUntil timed out");
}

export async function seedInferenceBudgetPolicy(
  database: Database,
  input: {
    readonly workspaceId: WorkspaceId;
    readonly enabled: boolean;
    readonly periodLimitUsdMicros: number;
    readonly now: Date;
  },
): Promise<void> {
  const policies = new PostgresInferenceBudgetPolicyRepository(database);
  await policies.savePolicy({
    id: BUDGET_POLICY_ID,
    workspaceId: input.workspaceId,
    key: "default",
    createdAt: input.now,
  });
  await policies.savePolicyVersion({
    id: BUDGET_POLICY_VERSION_ID,
    policyId: BUDGET_POLICY_ID,
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
      activePolicyVersionId: BUDGET_POLICY_VERSION_ID,
      updatedAt: input.now,
    });
  }
}

export function periodKeyFor(now: Date): InferenceBudgetPeriodKeyV1 {
  return resolveInferenceBudgetUtcPeriodIdentity(now)
    .periodKey as InferenceBudgetPeriodKeyV1;
}

export async function listReservations(
  database: Database,
  workspaceId: WorkspaceId,
): Promise<
  Array<{
    status: string;
    reservation_key: string;
    provider_attempt_index: number;
    selected_model_profile_version_id: string;
    pricing_snapshot_id: string;
    reserved_usd_micros: number;
    committed_usd_micros: number | null;
    uncertain_floor_usd_micros: number | null;
    provider_started_at: Date | null;
  }>
> {
  const rows = await database.sql`
    SELECT status, reservation_key, provider_attempt_index, selected_model_profile_version_id,
           pricing_snapshot_id, reserved_usd_micros, committed_usd_micros,
           uncertain_floor_usd_micros, provider_started_at
    FROM inference_budget_reservations
    WHERE workspace_id = ${workspaceId}
    ORDER BY provider_attempt_index, created_at
  `;
  return rows as typeof rows;
}

export async function readPeriodLedger(
  database: Database,
  workspaceId: WorkspaceId,
  periodKey: InferenceBudgetPeriodKeyV1,
): Promise<{
  reserved_usd_micros: number;
  committed_usd_micros: number;
  overage_usd_micros: number;
  unresolved_uncertain_liability_usd_micros: number;
} | null> {
  const rows = await database.sql`
    SELECT held_reservations_usd_micros, committed_liability_usd_micros,
           overage_usd_micros, unresolved_uncertain_liability_usd_micros
    FROM workspace_inference_budget_periods
    WHERE workspace_id = ${workspaceId} AND period_key = ${periodKey}
    LIMIT 1
  `;
  const row = rows[0] as Record<string, number> | undefined;
  if (row === undefined) {
    return null;
  }
  return {
    held_reservations_usd_micros: Number(row.held_reservations_usd_micros),
    committed_liability_usd_micros: Number(row.committed_liability_usd_micros),
    overage_usd_micros: Number(row.overage_usd_micros),
    unresolved_uncertain_liability_usd_micros: Number(
      row.unresolved_uncertain_liability_usd_micros,
    ),
  };
}

export async function activateInferenceBudgetPolicyViaApi(
  origin: string,
  policyVersionId: string,
): Promise<void> {
  const activated = await fetchJson(
    `${origin}/v1/workspace-inference-budget/activate`,
    {
      method: "POST",
      body: { policyVersionId },
    },
  );
  expectStatus(activated.status, 200);
}

export async function disableInferenceBudgetPolicyViaApi(
  origin: string,
): Promise<void> {
  const disabled = await fetchJson(
    `${origin}/v1/workspace-inference-budget/disable`,
    {
      method: "POST",
      body: {},
    },
  );
  expectStatus(disabled.status, 200);
}

export async function activateRoutingPolicy(
  origin: string,
  body: Record<string, unknown>,
): Promise<string> {
  const policy = await fetchJson(`${origin}/v1/inference-routing-policies`, {
    method: "POST",
    body,
  });
  expectStatus(policy.status, 201);
  const policyVersionId = (policy.body as { version: { id: string } }).version
    .id;
  const activated = await fetchJson(
    `${origin}/v1/inference-routing-policies/activate`,
    {
      method: "POST",
      body: { policyVersionId, enabled: true },
    },
  );
  expectStatus(activated.status, 200);
  return policyVersionId;
}

function expectStatus(actual: number, expected: number): void {
  if (actual !== expected) {
    throw new Error(
      `Expected HTTP ${String(expected)} but got ${String(actual)}`,
    );
  }
}

export async function createBudgetWorkerStack(input: {
  readonly postgres: PostgresTestContext;
  readonly valkey: ValkeyTestContext;
  readonly fakeOrigin: string;
  readonly fixtureName?: string;
  readonly agentKey?: string;
  readonly modelName?: string;
  readonly withCache?: boolean;
  readonly activationApiEnabled?: boolean;
}): Promise<BudgetWorkerStack> {
  const fixtureName = input.fixtureName ?? "model-text-agent.ts";
  const agentKey = input.agentKey ?? "model-text-agent";
  const modelName = input.modelName ?? "gpt-routing-test";

  const trustedRuntimeRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "osva-budget-worker-"),
  );
  await fs.copyFile(
    path.join(FIXTURE_DIR, fixtureName),
    path.join(trustedRuntimeRoot, fixtureName),
  );
  const integrity = sha256IntegrityOf(
    await fs.readFile(path.join(trustedRuntimeRoot, fixtureName)),
  );
  const env = {
    OSVA_DATABASE_URL: input.postgres.connectionString,
    OSVA_VALKEY_URL: input.valkey.url,
    OSVA_WEB_HOST: "127.0.0.1",
    OSVA_WEB_PORT: "0",
    OPENAI_API_KEY: "test-key",
    ...(input.activationApiEnabled === true
      ? { OSVA_INFERENCE_BUDGET_ACTIVATION_ENABLED: "true" }
      : {}),
  };

  const web = createWebProcess(withTestAuthEnv(env));
  const cache =
    input.withCache === true
      ? new ValkeyExactResponseCache({
          url: input.valkey.url,
          wireProtection: createAesGcmWireProtection({
            keyRing: INTEGRATION_CACHE_KEY_RING,
            rejectLegacyPlaintext: true,
          }),
        })
      : undefined;
  const worker = createWorkerProcess(
    { ...env, OSVA_TRUSTED_RUNTIME_ROOT: trustedRuntimeRoot },
    (connectionString) => createDatabase({ connectionString, max: 5 }),
    {
      openai: {
        apiKey: "test-key",
        baseURL: `${input.fakeOrigin}/v1`,
        maxRetries: 0,
      },
      ...(input.withCache === true && cache !== undefined
        ? {
            exactResponseCache: cache,
            trustedInferenceResponseCachePolicy: TRUSTED_CACHE_POLICY,
          }
        : {}),
    },
  );
  const inspector = new BullMqJobQueue({ url: input.valkey.url });
  const port = await web.listen();
  await worker.start();
  const origin = `http://127.0.0.1:${String(port)}`;

  const connection = await fetchJson(
    `${origin}/v1/model-provider-connections`,
    {
      method: "POST",
      body: {
        key: "conn-budget-worker",
        name: "Budget worker",
        provider: "OPENAI",
      },
    },
  );
  const connectionId = (connection.body as { id: string }).id;
  const connectionVersion = await fetchJson(
    `${origin}/v1/model-provider-connections/${connectionId}/versions`,
    {
      method: "POST",
      body: {
        endpoint: {
          baseUrl: `${input.fakeOrigin}/v1`,
          allowPrivateNetworks: true,
        },
        credentialRef: { key: "OPENAI_API_KEY" },
      },
    },
  );
  const connectionVersionId = (connectionVersion.body as { id: string }).id;

  const profile = await fetchJson(`${origin}/v1/model-profiles`, {
    method: "POST",
    body: { key: "budget-primary", name: "Budget Primary" },
  });
  const modelProfileId = (profile.body as { id: string }).id;
  const version = await fetchJson(
    `${origin}/v1/model-profiles/${modelProfileId}/versions`,
    {
      method: "POST",
      body: {
        provider: "OPENAI",
        model: modelName,
        modelProviderConnectionVersionId: connectionVersionId,
        pricing: {
          currency: "USD",
          inputUsdMicrosPerMillionTokens: 1_000_000,
          outputUsdMicrosPerMillionTokens: 2_000_000,
        },
      },
    },
  );
  const modelProfileVersionId = (version.body as { id: string }).id;

  const cheapProfile = await fetchJson(`${origin}/v1/model-profiles`, {
    method: "POST",
    body: { key: "budget-cheap", name: "Budget Cheap" },
  });
  const cheapProfileId = (cheapProfile.body as { id: string }).id;
  const cheapVersion = await fetchJson(
    `${origin}/v1/model-profiles/${cheapProfileId}/versions`,
    {
      method: "POST",
      body: {
        provider: "OPENAI",
        model: "gpt-routing-cheap",
        modelProviderConnectionVersionId: connectionVersionId,
        pricing: {
          currency: "USD",
          inputUsdMicrosPerMillionTokens: 100_000,
          outputUsdMicrosPerMillionTokens: 100_000,
        },
      },
    },
  );
  const cheapModelProfileVersionId = (cheapVersion.body as { id: string }).id;

  const agent = await fetchJson(`${origin}/v1/agents`, {
    method: "POST",
    body: { key: agentKey, name: agentKey },
  });
  const agentId = (agent.body as { id: string }).id;
  const agentVersion = await fetchJson(
    `${origin}/v1/agents/${agentId}/versions`,
    {
      method: "POST",
      body: {
        manifest: {
          schemaVersion: "1",
          key: agentKey,
          name: agentKey,
          runtime: {
            type: "TRUSTED_TYPESCRIPT",
            entrypoint: fixtureName,
            integrity,
          },
          input: { schema: {} },
          output: { schema: {} },
          execution: { timeoutMs: 12_000, maxAttempts: 1 },
          capabilities: { model: true, tools: [] },
          models: { primary: { modelProfileVersionId } },
        },
      },
    },
  );
  const agentVersionId = (agentVersion.body as { id: string }).id;

  async function createModelVersion(opts: {
    readonly key: string;
    readonly model: string;
    readonly inputUsdMicrosPerMillionTokens?: number;
    readonly modelProviderConnectionVersionId?: string;
  }): Promise<string> {
    const profile = await fetchJson(`${origin}/v1/model-profiles`, {
      method: "POST",
      body: { key: opts.key, name: opts.key },
    });
    const mpId = (profile.body as { id: string }).id;
    const mpVersion = await fetchJson(
      `${origin}/v1/model-profiles/${mpId}/versions`,
      {
        method: "POST",
        body: {
          provider: "OPENAI",
          model: opts.model,
          modelProviderConnectionVersionId:
            opts.modelProviderConnectionVersionId ?? connectionVersionId,
          pricing: {
            currency: "USD",
            inputUsdMicrosPerMillionTokens:
              opts.inputUsdMicrosPerMillionTokens ?? 1_000_000,
            outputUsdMicrosPerMillionTokens:
              opts.inputUsdMicrosPerMillionTokens ?? 2_000_000,
          },
        },
      },
    );
    return (mpVersion.body as { id: string }).id;
  }

  return {
    origin,
    worker,
    web,
    inspector,
    agentId,
    agentVersionId,
    modelProfileVersionId,
    cheapModelProfileVersionId,
    connectionVersionId,
    createModelVersion,
    async shutdown() {
      await worker.stop();
      await inspector.shutdown();
      await web.stop();
    },
  };
}

export async function createRun(
  origin: string,
  agentId: string,
  agentVersionId: string,
  prompt = "budget-worker",
): Promise<{ runId: string; runAttemptId: string }> {
  const created = await fetchJson(`${origin}/v1/runs`, {
    method: "POST",
    body: {
      agentId,
      agentVersionId,
      input: { prompt },
    },
  });
  expectStatus(created.status, 201);
  return {
    runId: (created.body as { run: { id: string } }).run.id,
    runAttemptId: (created.body as { runAttempt: { id: string } }).runAttempt
      .id,
  };
}

export async function waitForRunTerminal(
  origin: string,
  runId: string,
): Promise<string> {
  let terminal = "RUNNING";
  await waitUntil(async () => {
    const run = await fetchJson(`${origin}/v1/runs/${runId}`);
    if (run.status !== 200) {
      return false;
    }
    terminal = (run.body as { status?: string }).status ?? terminal;
    return terminal === "SUCCEEDED" || terminal === "FAILED";
  });
  return terminal;
}

export async function runAgentOnce(
  origin: string,
  agentId: string,
  agentVersionId: string,
  prompt = "budget-worker",
): Promise<{ runId: string; runAttemptId: string; terminal: string }> {
  const { runId, runAttemptId } = await createRun(
    origin,
    agentId,
    agentVersionId,
    prompt,
  );
  const terminal = await waitForRunTerminal(origin, runId);
  return { runId, runAttemptId, terminal };
}
