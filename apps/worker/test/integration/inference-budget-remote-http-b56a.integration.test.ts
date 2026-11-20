/**
 * B5.6A — REMOTE_HTTP runtime inference budget acceptance (H1–H7 subset).
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { WorkspaceId } from "@osva-ai/contracts";
import { createDatabase, migrateDatabase, type Database } from "@osva/db";

import { startFakeRemoteRuntime } from "../../../../adapters/runtime-http/test/fake-remote-runtime.js";
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
  listReservations,
  seedInferenceBudgetPolicy,
} from "./inference-budget-worker-harness.js";

const WORKSPACE_ID = "ws-remote-budget-b56a" as WorkspaceId;
const NOW = new Date("2026-02-15T12:00:00.000Z");

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

describe("B5.6A REMOTE_HTTP inference budget", () => {
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
  }, 180_000);

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
  ): Promise<{
    origin: string;
    worker: ReturnType<typeof createWorkerProcess>;
    stop(): Promise<void>;
  }> {
    const trustedRuntimeRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), "osva-remote-budget-b56a-"),
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
        OSVA_RUNTIME_CAPABILITY_SECRET: "capability-secret-b56a",
        OSVA_REMOTE_HTTP_ALLOW_PRIVATE_NETWORKS: "true",
      },
      (connectionString) => createDatabase({ connectionString, max: 5 }),
      {
        openai: {
          apiKey: "test-key",
          baseURL: fakeOrigin.endsWith("/v1") ? fakeOrigin : `${fakeOrigin}/v1`,
          maxRetries: 0,
        },
      },
    );
    const port = await web.listen();
    await worker.start();
    return {
      origin: `http://127.0.0.1:${String(port)}`,
      worker,
      async stop() {
        await worker.stop();
        await web.stop();
      },
    };
  }

  async function createModelProfileVersion(
    origin: string,
    fakeOrigin: string,
  ): Promise<string> {
    const connection = await fetchJson(
      `${origin}/v1/model-provider-connections`,
      {
        method: "POST",
        body: {
          key: `conn-remote-b56a-${String(Date.now())}`,
          name: "Remote b56a",
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
            baseUrl: fakeOrigin.endsWith("/v1")
              ? fakeOrigin
              : `${fakeOrigin}/v1`,
            allowPrivateNetworks: true,
          },
          credentialRef: { key: "OPENAI_API_KEY" },
        },
      },
    );
    const connectionVersionId = (connectionVersion.body as { id: string }).id;

    const profile = await fetchJson(`${origin}/v1/model-profiles`, {
      method: "POST",
      body: { key: "remote-primary", name: "Remote Primary" },
    });
    const modelProfileId = (profile.body as { id: string }).id;
    const version = await fetchJson(
      `${origin}/v1/model-profiles/${modelProfileId}/versions`,
      {
        method: "POST",
        body: {
          provider: "OPENAI",
          model: "gpt-test-snapshot",
          modelProviderConnectionVersionId: connectionVersionId,
          pricing: {
            currency: "USD",
            inputUsdMicrosPerMillionTokens: 1_000_000,
            outputUsdMicrosPerMillionTokens: 2_000_000,
          },
        },
      },
    );
    return (version.body as { id: string }).id;
  }

  async function createRemoteModelRun(
    origin: string,
    remoteEndpoint: string,
    modelProfileVersionId: string,
    input: unknown,
  ): Promise<{ runId: string; runAttemptId: string }> {
    const agent = await fetchJson(`${origin}/v1/agents`, {
      method: "POST",
      body: {
        key: `remote-budget-${String(Date.now())}`,
        name: "Remote Budget",
      },
    });
    const agentId = (agent.body as { id: string }).id;
    const version = await fetchJson(`${origin}/v1/agents/${agentId}/versions`, {
      method: "POST",
      body: {
        manifest: {
          schemaVersion: "1",
          key: "remote-budget",
          name: "Remote Budget",
          runtime: {
            type: "REMOTE_HTTP",
            protocolVersion: "1",
            endpoint: remoteEndpoint,
          },
          input: { schema: {} },
          output: { schema: {} },
          execution: { timeoutMs: 20_000, maxAttempts: 1 },
          capabilities: { model: true, tools: [] },
          models: { primary: { modelProfileVersionId } },
        },
      },
    });
    const agentVersionId = (version.body as { id: string }).id;
    const created = await fetchJson(`${origin}/v1/runs`, {
      method: "POST",
      body: { agentId, agentVersionId, input },
    });
    return {
      runId: (created.body as { run: { id: string } }).run.id,
      runAttemptId: (created.body as { runAttempt: { id: string } }).runAttempt
        .id,
    };
  }

  async function seedBudget(
    periodLimitUsdMicros: number,
    enabledViaDb: boolean,
  ): Promise<void> {
    await seedInferenceBudgetPolicy(database, {
      workspaceId: WORKSPACE_ID,
      enabled: enabledViaDb,
      periodLimitUsdMicros,
      now: NOW,
    });
  }

  it("H1/H2: enabled budget admits through capability bridge before provider I/O", async () => {
    const remote = await startFakeRemoteRuntime({ callModel: true });
    const fakeOpenAI = await startFakeOpenAIResponsesServer();
    const stack = await startStack(fakeOpenAI.origin, true);
    try {
      await seedBudget(10_000_000, false);
      const modelProfileVersionId = await createModelProfileVersion(
        stack.origin,
        fakeOpenAI.origin,
      );
      await activateRoutingPolicy(stack.origin, {
        key: "remote-routing",
        definition: {
          schemaVersion: "1",
          strategy: "PRIORITY_WITH_FALLBACK",
          candidateModelProfileVersionIds: [modelProfileVersionId],
          allowFallback: false,
          maxProviderAttempts: 1,
        },
      });
      await activateInferenceBudgetPolicyViaApi(
        stack.origin,
        BUDGET_POLICY_VERSION_ID,
      );

      const created = await createRemoteModelRun(
        stack.origin,
        `${remote.origin}/execute`,
        modelProfileVersionId,
        { prompt: "remote-budget-h1" },
      );

      await waitUntil(async () => {
        const run = await fetchJson(`${stack.origin}/v1/runs/${created.runId}`);
        return (run.body as { status?: string }).status === "SUCCEEDED";
      });

      expect(remote.executeCount).toBeGreaterThan(0);
      expect(
        (await listReservations(database, WORKSPACE_ID)).length,
      ).toBeGreaterThan(0);
    } finally {
      await stack.stop();
      await remote.close();
      await fakeOpenAI.close();
    }
  }, 90_000);

  it("H3: insufficient budget — zero provider HTTP", async () => {
    const remote = await startFakeRemoteRuntime({ callModel: true });
    const fakeOpenAI = await startFakeOpenAIResponsesServer();
    const stack = await startStack(fakeOpenAI.origin, true);
    try {
      await seedBudget(100, false);
      const modelProfileVersionId = await createModelProfileVersion(
        stack.origin,
        fakeOpenAI.origin,
      );
      await activateRoutingPolicy(stack.origin, {
        key: "remote-routing-deny",
        definition: {
          schemaVersion: "1",
          strategy: "PRIORITY_WITH_FALLBACK",
          candidateModelProfileVersionIds: [modelProfileVersionId],
          allowFallback: false,
          maxProviderAttempts: 1,
        },
      });
      await activateInferenceBudgetPolicyViaApi(
        stack.origin,
        BUDGET_POLICY_VERSION_ID,
      );

      const created = await createRemoteModelRun(
        stack.origin,
        `${remote.origin}/execute`,
        modelProfileVersionId,
        { prompt: "remote-budget-deny" },
      );

      await waitUntil(async () => {
        const run = await fetchJson(`${stack.origin}/v1/runs/${created.runId}`);
        const status = (run.body as { status?: string }).status;
        return status === "FAILED" || status === "SUCCEEDED";
      });

      expect(fakeOpenAI.requests.length).toBe(0);
      expect((await listReservations(database, WORKSPACE_ID)).length).toBe(0);
    } finally {
      await stack.stop();
      await remote.close();
      await fakeOpenAI.close();
    }
  }, 60_000);

  it("H4: missing capability secret fails closed with zero provider calls", async () => {
    const remote = await startFakeRemoteRuntime({ callModel: true });
    const fakeOpenAI = await startFakeOpenAIResponsesServer();
    const trustedRuntimeRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), "osva-remote-budget-h4-"),
    );
    const web = createWebProcess(
      withTestAuthEnv({
        OSVA_DATABASE_URL: postgres.connectionString,
        OSVA_VALKEY_URL: valkey.url,
        OSVA_WEB_HOST: "127.0.0.1",
        OSVA_WEB_PORT: "0",
        OSVA_INFERENCE_BUDGET_ACTIVATION_ENABLED: "true",
      }),
    );
    const worker = createWorkerProcess(
      {
        OSVA_DATABASE_URL: postgres.connectionString,
        OSVA_VALKEY_URL: valkey.url,
        OSVA_TRUSTED_RUNTIME_ROOT: trustedRuntimeRoot,
        OSVA_REMOTE_HTTP_ALLOW_PRIVATE_NETWORKS: "true",
      },
      (connectionString) => createDatabase({ connectionString, max: 5 }),
      {
        openai: {
          apiKey: "test-key",
          baseURL: fakeOpenAI.origin,
          maxRetries: 0,
        },
      },
    );
    try {
      await seedBudget(10_000_000, false);
      const port = await web.listen();
      await worker.start();
      const origin = `http://127.0.0.1:${String(port)}`;
      const modelProfileVersionId = await createModelProfileVersion(
        origin,
        fakeOpenAI.origin,
      );
      await activateRoutingPolicy(origin, {
        key: "remote-routing-h4",
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

      const created = await createRemoteModelRun(
        origin,
        `${remote.origin}/execute`,
        modelProfileVersionId,
        { prompt: "remote-budget-h4" },
      );

      await waitUntil(async () => {
        const run = await fetchJson(`${origin}/v1/runs/${created.runId}`);
        return (run.body as { status?: string }).status === "FAILED";
      });

      expect(fakeOpenAI.requests.length).toBe(0);
      expect(remote.executeCount).toBe(0);
    } finally {
      await worker.stop();
      await web.stop();
      await remote.close();
      await fakeOpenAI.close();
    }
  }, 60_000);

  it("H7/D5 parity: disabled budget preserves unscoped remote model path", async () => {
    const remote = await startFakeRemoteRuntime({ callModel: true });
    const fakeOpenAI = await startFakeOpenAIResponsesServer();
    const stack = await startStack(fakeOpenAI.origin, true);
    try {
      await seedBudget(10_000_000, false);
      const modelProfileVersionId = await createModelProfileVersion(
        stack.origin,
        fakeOpenAI.origin,
      );
      const created = await createRemoteModelRun(
        stack.origin,
        `${remote.origin}/execute`,
        modelProfileVersionId,
        { prompt: "remote-budget-disabled" },
      );

      await waitUntil(async () => {
        const run = await fetchJson(`${stack.origin}/v1/runs/${created.runId}`);
        return (run.body as { status?: string }).status === "SUCCEEDED";
      });

      expect((await listReservations(database, WORKSPACE_ID)).length).toBe(0);
      expect(remote.executeCount).toBeGreaterThan(0);
    } finally {
      await stack.stop();
      await remote.close();
      await fakeOpenAI.close();
    }
  }, 60_000);
});
