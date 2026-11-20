/**
 * B5.6A — Declarative runtime inference budget acceptance (D1–D5).
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { WorkspaceId } from "@osva-ai/contracts";
import { createDatabase, migrateDatabase, type Database } from "@osva/db";

import { startFakeOpenAIResponsesServer } from "../../../../adapters/model-openai/test/fake-openai-server.js";
import { withTestAuthEnv } from "../../../../packages/db/test/integration/web-auth-env.js";
import { createWebProcess } from "../../../web/src/process.js";
import { createWorkerProcess } from "../../src/process.js";
import {
  resetStage0Tables,
  startPostgresForTests,
  stopPostgresForTests,
  type PostgresTestContext,
} from "../../../../packages/db/test/integration/postgres-harness.js";
import {
  startValkeyForTests,
  stopValkeyForTests,
  type ValkeyTestContext,
} from "../../../../adapters/bullmq/test/integration/valkey-harness.js";
import { bootstrapIntegrationAuth, fetchJson } from "./integration-auth.js";
import {
  activateInferenceBudgetPolicyViaApi,
  activateRoutingPolicy,
  BUDGET_POLICY_VERSION_ID,
  disableInferenceBudgetPolicyViaApi,
  listReservations,
  seedInferenceBudgetPolicy,
} from "./inference-budget-worker-harness.js";

const WORKSPACE_ID = "ws-decl-budget-b56a" as WorkspaceId;
const NOW = new Date("2026-02-15T12:00:00.000Z");

const OUTPUT_SCHEMA = {
  type: "object",
  properties: { answer: { type: "string" } },
  required: ["answer"],
  additionalProperties: false,
};

async function waitUntil(
  predicate: () => Promise<boolean>,
  timeoutMs = 45_000,
): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Timed out waiting for condition.");
}

describe("B5.6A declarative inference budget", () => {
  let postgres: PostgresTestContext;
  let valkey: ValkeyTestContext;
  let database: Database;

  beforeAll(async () => {
    postgres = await startPostgresForTests();
    valkey = await startValkeyForTests();
    database = createDatabase({
      connectionString: postgres.connectionString,
      max: 5,
      connectTimeoutSeconds: 10,
    });
    await migrateDatabase(database);
  });

  afterAll(async () => {
    await database.close();
    await stopPostgresForTests(postgres);
    await stopValkeyForTests(valkey);
  });

  beforeEach(async () => {
    await resetStage0Tables(database);
    await bootstrapIntegrationAuth(database, WORKSPACE_ID, NOW);
  });

  async function startStack(
    fakeOrigin: string,
    activationApi = false,
  ): Promise<{ origin: string; stop(): Promise<void> }> {
    const trustedRuntimeRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), "osva-decl-budget-b56a-"),
    );
    const web = createWebProcess(
      withTestAuthEnv({
        OSVA_DATABASE_URL: postgres.connectionString,
        OSVA_VALKEY_URL: valkey.url,
        OSVA_WEB_HOST: "127.0.0.1",
        OSVA_WEB_PORT: "0",
        ...(activationApi
          ? { OSVA_INFERENCE_BUDGET_ACTIVATION_ENABLED: "true" }
          : {}),
      }),
    );
    const worker = createWorkerProcess(
      {
        OSVA_DATABASE_URL: postgres.connectionString,
        OSVA_VALKEY_URL: valkey.url,
        OSVA_TRUSTED_RUNTIME_ROOT: trustedRuntimeRoot,
      },
      (connectionString) => createDatabase({ connectionString, max: 5 }),
      {
        openai: {
          apiKey: "test-key",
          baseURL: fakeOrigin,
          maxRetries: 0,
        },
      },
    );
    const port = await web.listen();
    await worker.start();
    return {
      origin: `http://127.0.0.1:${String(port)}`,
      async stop() {
        await worker.stop();
        await web.stop();
      },
    };
  }

  async function seedDeclarativeRun(
    origin: string,
    fake: Awaited<ReturnType<typeof startFakeOpenAIResponsesServer>>,
    budgetEnabled: boolean,
    periodLimitUsdMicros: number,
  ): Promise<{
    runId: string;
    runAttemptId: string;
    modelProfileVersionId: string;
    agentId: string;
    agentVersionId: string;
  }> {
    if (budgetEnabled) {
      await seedInferenceBudgetPolicy(database, {
        workspaceId: WORKSPACE_ID,
        enabled: false,
        periodLimitUsdMicros,
        now: NOW,
      });
    }

    const profile = await fetchJson(`${origin}/v1/model-profiles`, {
      method: "POST",
      body: { key: "primary", name: "Primary" },
    });
    const modelProfileId = (profile.body as { id: string }).id;
    const version = await fetchJson(
      `${origin}/v1/model-profiles/${modelProfileId}/versions`,
      {
        method: "POST",
        body: {
          provider: "OPENAI",
          model: "gpt-test-snapshot",
          pricing: {
            currency: "USD",
            inputUsdMicrosPerMillionTokens: 1_000_000,
            outputUsdMicrosPerMillionTokens: 2_000_000,
          },
        },
      },
    );
    const modelProfileVersionId = (version.body as { id: string }).id;

    const agent = await fetchJson(`${origin}/v1/agents`, {
      method: "POST",
      body: {
        key: `declarative-budget-${String(Date.now())}`,
        name: "Declarative Budget",
      },
    });
    const agentId = (agent.body as { id: string }).id;
    const agentVersion = await fetchJson(
      `${origin}/v1/agents/${agentId}/versions`,
      {
        method: "POST",
        body: {
          manifest: {
            schemaVersion: "1",
            key: "declarative-budget",
            name: "Declarative Budget",
            runtime: {
              type: "DECLARATIVE",
              config: {
                configVersion: "1",
                instructions: "Respond with JSON answer field only.",
                modelBinding: "primary",
                allowedToolBindings: [],
                maxModelInvocations: 2,
                maxToolInvocations: 0,
                maxOutputTokens: 128,
              },
            },
            input: { schema: { type: "object" } },
            output: { schema: OUTPUT_SCHEMA },
            execution: { timeoutMs: 20_000, maxAttempts: 1 },
            capabilities: { model: true, tools: [] },
            models: { primary: { modelProfileVersionId } },
          },
        },
      },
    );
    const agentVersionId = (agentVersion.body as { id: string }).id;

    if (budgetEnabled) {
      await activateRoutingPolicy(origin, {
        key: "routing",
        definition: {
          schemaVersion: "1",
          strategy: "PRIORITY_WITH_FALLBACK",
          candidateModelProfileVersionIds: [modelProfileVersionId],
          allowFallback: false,
          maxProviderAttempts: 1,
        },
      });
      await activateInferenceBudgetPolicyViaApi(
        origin,
        BUDGET_POLICY_VERSION_ID,
      );
    }

    const created = await fetchJson(`${origin}/v1/runs`, {
      method: "POST",
      body: {
        agentId,
        agentVersionId,
        input: { scenario: "declarative-budget-d1" },
      },
    });
    return {
      runId: (created.body as { run: { id: string } }).run.id,
      runAttemptId: (created.body as { runAttempt: { id: string } }).runAttempt
        .id,
      modelProfileVersionId,
      agentId,
      agentVersionId,
    };
  }

  it("D1/D5: enabled budget admits before provider I/O; disabled budget unchanged", async () => {
    const fake = await startFakeOpenAIResponsesServer();
    const stack = await startStack(fake.origin, true);
    try {
      const enabled = await seedDeclarativeRun(
        stack.origin,
        fake,
        true,
        10_000_000,
      );
      await waitUntil(async () => {
        const run = await fetchJson(`${stack.origin}/v1/runs/${enabled.runId}`);
        return (run.body as { status?: string }).status === "SUCCEEDED";
      });
      expect(fake.requests.length).toBeGreaterThan(0);
      expect(
        (await listReservations(database, WORKSPACE_ID)).length,
      ).toBeGreaterThan(0);

      await disableInferenceBudgetPolicyViaApi(stack.origin);
      const callsBefore = fake.requests.length;
      const disabled = await fetchJson(`${stack.origin}/v1/runs`, {
        method: "POST",
        body: {
          agentId: enabled.agentId,
          agentVersionId: enabled.agentVersionId,
          input: { scenario: "declarative-budget-d1-disabled" },
        },
      });
      expect(disabled.status).toBe(201);
      const disabledRunId = (disabled.body as { run: { id: string } }).run.id;
      await waitUntil(async () => {
        const run = await fetchJson(`${stack.origin}/v1/runs/${disabledRunId}`);
        return (run.body as { status?: string }).status === "SUCCEEDED";
      });
      expect(fake.requests.length).toBeGreaterThan(callsBefore);
    } finally {
      await stack.stop();
      await fake.close();
    }
  }, 90_000);

  it("D2: insufficient budget — zero provider I/O", async () => {
    const fake = await startFakeOpenAIResponsesServer();
    const stack = await startStack(fake.origin, true);
    try {
      const { runId } = await seedDeclarativeRun(stack.origin, fake, true, 100);
      await waitUntil(async () => {
        const run = await fetchJson(`${stack.origin}/v1/runs/${runId}`);
        const status = (run.body as { status?: string }).status;
        return status === "FAILED" || status === "SUCCEEDED";
      });
      expect(fake.requests.length).toBe(0);
      expect((await listReservations(database, WORKSPACE_ID)).length).toBe(0);
    } finally {
      await stack.stop();
      await fake.close();
    }
  }, 60_000);

  it("D4: post-startup activation honored on subsequent run", async () => {
    const fake = await startFakeOpenAIResponsesServer();
    const stack = await startStack(fake.origin, true);
    try {
      await seedInferenceBudgetPolicy(database, {
        workspaceId: WORKSPACE_ID,
        enabled: false,
        periodLimitUsdMicros: 10_000_000,
        now: NOW,
      });

      const before = await seedDeclarativeRun(
        stack.origin,
        fake,
        false,
        10_000_000,
      );
      await waitUntil(async () => {
        const run = await fetchJson(`${stack.origin}/v1/runs/${before.runId}`);
        return (run.body as { status?: string }).status === "SUCCEEDED";
      });
      expect((await listReservations(database, WORKSPACE_ID)).length).toBe(0);

      await activateRoutingPolicy(stack.origin, {
        key: "routing-post-start",
        definition: {
          schemaVersion: "1",
          strategy: "PRIORITY_WITH_FALLBACK",
          candidateModelProfileVersionIds: [before.modelProfileVersionId],
          allowFallback: false,
          maxProviderAttempts: 1,
        },
      });
      await activateInferenceBudgetPolicyViaApi(
        stack.origin,
        BUDGET_POLICY_VERSION_ID,
      );

      const afterRun = await fetchJson(`${stack.origin}/v1/runs`, {
        method: "POST",
        body: {
          agentId: before.agentId,
          agentVersionId: before.agentVersionId,
          input: { scenario: "declarative-budget-d4-after-activation" },
        },
      });
      const afterRunId = (afterRun.body as { run: { id: string } }).run.id;
      await waitUntil(async () => {
        const run = await fetchJson(`${stack.origin}/v1/runs/${afterRunId}`);
        return (run.body as { status?: string }).status === "SUCCEEDED";
      });
      expect(
        (await listReservations(database, WORKSPACE_ID)).length,
      ).toBeGreaterThan(0);
    } finally {
      await stack.stop();
      await fake.close();
    }
  }, 90_000);
});
