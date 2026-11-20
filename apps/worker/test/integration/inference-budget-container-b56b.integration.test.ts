/**
 * B5.6B — Container runtime inference budget acceptance (K1–K10).
 */
import { RUNTIME_CAPABILITY_PATHS } from "@osva-ai/runtime-protocol";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Redis } from "ioredis";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import type { WorkspaceId } from "@osva-ai/contracts";
import { createDatabase, migrateDatabase, type Database } from "@osva/db";
import { startFakeOpenAIResponsesServer } from "../../../../adapters/model-openai/test/fake-openai-server.js";
import {
  buildExampleContainerImage,
  isDockerAvailable,
  assertNoOsvaManagedContainers,
  type ExampleContainerImageFixture,
} from "../../../../adapters/runtime-container/test/integration/docker-harness.js";
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
  periodKeyFor,
  readPeriodLedger,
  seedInferenceBudgetPolicy,
} from "./inference-budget-worker-harness.js";

const WORKSPACE_ID = "ws-container-budget-b56b" as WorkspaceId;
const NOW = new Date("2026-02-20T12:00:00.000Z");
const CAPABILITY_SECRET = "container-budget-b56b-secret";
const dockerAvailable = isDockerAvailable();

async function waitUntil(
  predicate: () => Promise<boolean>,
  timeoutMs = 120_000,
): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(
    `Timed out waiting for condition after ${String(timeoutMs)}ms.`,
  );
}

async function waitForRunTerminal(
  origin: string,
  database: Database,
  runId: string,
  timeoutMs = 120_000,
): Promise<string> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const run = await fetchJson(`${origin}/v1/runs/${runId}`);
    const status = (run.body as { status?: string }).status ?? "UNKNOWN";
    if (status === "SUCCEEDED") {
      return status;
    }
    if (status === "FAILED" || status === "CANCELLED") {
      throw new Error(
        `Run reached terminal ${status}: ${await runAttemptDiagnostics(database, runId)}`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(
    `Timed out waiting for run terminal state after ${String(timeoutMs)}ms: ${await runAttemptDiagnostics(database, runId)}`,
  );
}

async function runAttemptDiagnostics(
  database: Database,
  runId: string,
): Promise<string> {
  const [runRow] = await database.sql<{ status: string }[]>`
    SELECT status FROM runs WHERE id = ${runId}
  `;
  const attempts = await database.sql<
    {
      status: string;
      execution_owner: string | null;
      lease_expires_at: Date | null;
      error: { code?: string; message?: string } | null;
    }[]
  >`
    SELECT status, execution_owner, lease_expires_at, error
    FROM run_attempts
    WHERE run_id = ${runId}
  `;
  return `run=${JSON.stringify(runRow)} attempts=${JSON.stringify(attempts)}`;
}

describe.skipIf(!dockerAvailable)("B5.6B container inference budget", () => {
  let postgres: PostgresTestContext;
  let valkey: ValkeyTestContext;
  let database: Database;
  let exampleImage: ExampleContainerImageFixture;
  let redis: Redis;

  beforeAll(async () => {
    exampleImage = await buildExampleContainerImage();
    postgres = await startPostgresForTests();
    valkey = await startValkeyForTests();
    redis = new Redis(valkey.url, {
      maxRetriesPerRequest: 1,
      connectTimeout: 2_000,
      commandTimeout: 2_000,
    });
    database = createDatabase({
      connectionString: postgres.connectionString,
      max: 5,
      connectTimeoutSeconds: 10,
    });
    await migrateDatabase(database);
  }, 360_000);

  afterAll(async () => {
    await assertNoOsvaManagedContainers();
    await redis.quit();
    await database.close();
    await stopPostgresForTests(postgres);
    await stopValkeyForTests(valkey);
  });

  beforeEach(async () => {
    await redis.flushall();
    await resetStage0Tables(database);
    await bootstrapIntegrationAuth(database, WORKSPACE_ID, NOW);
  });

  afterEach(async () => {
    await redis.flushall();
  });

  async function startStack(
    fakeOrigin: string,
    options: {
      readonly activationApi?: boolean;
      readonly capabilitySecret?: string;
      readonly containerCapabilityBaseUrl?: string;
    } = {},
  ): Promise<{ origin: string; stop(): Promise<void> }> {
    const trustedRuntimeRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), "osva-container-budget-b56b-"),
    );
    const secret = options.capabilitySecret ?? CAPABILITY_SECRET;
    const web = createWebProcess(
      withTestAuthEnv({
        OSVA_DATABASE_URL: postgres.connectionString,
        OSVA_VALKEY_URL: valkey.url,
        OSVA_WEB_HOST: "127.0.0.1",
        OSVA_WEB_PORT: "0",
        ...(options.activationApi
          ? { OSVA_INFERENCE_BUDGET_ACTIVATION_ENABLED: "true" }
          : {}),
      }),
    );
    const worker = createWorkerProcess(
      {
        OSVA_DATABASE_URL: postgres.connectionString,
        OSVA_VALKEY_URL: valkey.url,
        OSVA_TRUSTED_RUNTIME_ROOT: trustedRuntimeRoot,
        OSVA_CONTAINER_ENABLED: "true",
        OSVA_RUNTIME_CAPABILITY_SECRET: secret,
        OSVA_CONTAINER_NETWORK_MODE: "bridge",
        OPENAI_API_KEY: "test-key",
        ...(options.containerCapabilityBaseUrl !== undefined
          ? {
              OSVA_CONTAINER_CAPABILITY_BASE_URL:
                options.containerCapabilityBaseUrl,
            }
          : {}),
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
    const origin = `http://127.0.0.1:${String(port)}`;
    return {
      origin,
      async stop() {
        await worker.stop();
        await web.stop();
        await assertNoOsvaManagedContainers();
      },
    };
  }

  async function createModelProfileVersion(
    origin: string,
    fakeOrigin: string,
    model = "gpt-test-snapshot",
  ): Promise<string> {
    const connection = await fetchJson(
      `${origin}/v1/model-provider-connections`,
      {
        method: "POST",
        body: {
          key: `conn-ctr-b56b-${String(Date.now())}`,
          name: "Container budget",
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
      body: { key: "container-primary", name: "Container Primary" },
    });
    const modelProfileId = (profile.body as { id: string }).id;
    const version = await fetchJson(
      `${origin}/v1/model-profiles/${modelProfileId}/versions`,
      {
        method: "POST",
        body: {
          provider: "OPENAI",
          model,
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

  async function createContainerRun(
    origin: string,
    modelProfileVersionId: string,
    input: unknown,
  ): Promise<{ runId: string; runAttemptId: string }> {
    const agent = await fetchJson(`${origin}/v1/agents`, {
      method: "POST",
      body: {
        key: `container-budget-${String(Date.now())}`,
        name: "Container Budget",
      },
    });
    const agentId = (agent.body as { id: string }).id;
    const version = await fetchJson(`${origin}/v1/agents/${agentId}/versions`, {
      method: "POST",
      body: {
        manifest: {
          schemaVersion: "1",
          key: "container-budget",
          name: "Container Budget",
          runtime: {
            type: "CONTAINER",
            protocolVersion: "1",
            image: exampleImage.runtimeImageReference,
          },
          input: { schema: {} },
          output: { schema: {} },
          execution: { timeoutMs: 120_000, maxAttempts: 1 },
          capabilities: { model: true, tools: [] },
          models: { primary: { modelProfileVersionId } },
        },
      },
    });
    const agentVersionId = (version.body as { id: string }).id;
    const created = await fetchJson(`${origin}/v1/runs`, {
      method: "POST",
      body: {
        agentId,
        agentVersionId,
        input,
      },
    });
    expect(created.status).toBe(201);
    return {
      runId: (created.body as { run: { id: string } }).run.id,
      runAttemptId: (created.body as { runAttempt: { id: string } }).runAttempt
        .id,
    };
  }

  async function seedBudget(periodLimitUsdMicros: number): Promise<void> {
    await seedInferenceBudgetPolicy(database, {
      workspaceId: WORKSPACE_ID,
      enabled: false,
      periodLimitUsdMicros,
      now: NOW,
    });
  }

  async function seedAndActivateBudget(
    origin: string,
    modelProfileVersionId: string,
    routingKey: string,
    periodLimitUsdMicros: number,
  ): Promise<void> {
    await seedBudget(periodLimitUsdMicros);
    await activateRoutingPolicy(origin, {
      key: routingKey,
      definition: {
        schemaVersion: "1",
        strategy: "PRIORITY_WITH_FALLBACK",
        candidateModelProfileVersionIds: [modelProfileVersionId],
        allowFallback: false,
        maxProviderAttempts: 1,
      },
    });
    await activateInferenceBudgetPolicyViaApi(origin, BUDGET_POLICY_VERSION_ID);
  }

  it("K1: enabled budget — container model succeeds with admission settlement", async () => {
    const fake = await startFakeOpenAIResponsesServer();
    const stack = await startStack(fake.origin, { activationApi: true });
    try {
      const modelProfileVersionId = await createModelProfileVersion(
        stack.origin,
        fake.origin,
      );
      await seedAndActivateBudget(
        stack.origin,
        modelProfileVersionId,
        "container-routing-k1",
        10_000_000,
      );

      const created = await createContainerRun(
        stack.origin,
        modelProfileVersionId,
        {
          mode: "model",
          binding: "primary",
          prompt: "container-k1",
        },
      );

      expect(
        await waitForRunTerminal(stack.origin, database, created.runId),
      ).toBe("SUCCEEDED");
      expect(fake.requests.length).toBe(1);
      const reservations = await listReservations(database, WORKSPACE_ID);
      expect(reservations.length).toBeGreaterThan(0);
      expect(
        reservations.some(
          (row) =>
            row.provider_started_at !== null ||
            row.status === "PROVIDER_STARTED" ||
            row.status === "COMMITTED",
        ),
      ).toBe(true);
    } finally {
      await stack.stop();
      await fake.close();
    }
  }, 180_000);

  it("K2: admission and PROVIDER_STARTED precede provider HTTP", async () => {
    const fake = await startFakeOpenAIResponsesServer();
    const stack = await startStack(fake.origin, { activationApi: true });
    try {
      const modelProfileVersionId = await createModelProfileVersion(
        stack.origin,
        fake.origin,
        "gpt-budget-slow",
      );
      await seedAndActivateBudget(
        stack.origin,
        modelProfileVersionId,
        "container-routing-k2",
        10_000_000,
      );

      const created = await createContainerRun(
        stack.origin,
        modelProfileVersionId,
        {
          mode: "model",
          binding: "primary",
          prompt: "container-k2",
        },
      );

      let admittedBeforeProvider = false;
      let providerStartedAtBoundary = false;
      await waitUntil(async () => {
        const rows = await listReservations(database, WORKSPACE_ID);
        if (rows.length > 0 && fake.requests.length === 0) {
          admittedBeforeProvider = true;
        }
        if (fake.requests.length >= 1) {
          const started = rows.some(
            (row) =>
              row.provider_started_at !== null ||
              row.status === "PROVIDER_STARTED" ||
              row.status === "COMMITTED",
          );
          if (!started) {
            throw new Error(
              `Provider HTTP observed before PROVIDER_STARTED: reservations=${JSON.stringify(rows)} requests=${String(fake.requests.length)}`,
            );
          }
          providerStartedAtBoundary = true;
        }
        const run = await fetchJson(`${stack.origin}/v1/runs/${created.runId}`);
        return (run.body as { status?: string }).status === "SUCCEEDED";
      });

      expect(admittedBeforeProvider).toBe(true);
      expect(providerStartedAtBoundary).toBe(true);
      expect(fake.requests.length).toBe(1);
      expect(
        await waitForRunTerminal(stack.origin, database, created.runId),
      ).toBe("SUCCEEDED");
    } finally {
      await stack.stop();
      await fake.close();
    }
  }, 180_000);

  it("K3: insufficient budget — zero provider HTTP", async () => {
    const fake = await startFakeOpenAIResponsesServer();
    const stack = await startStack(fake.origin, { activationApi: true });
    try {
      await seedBudget(100);
      const modelProfileVersionId = await createModelProfileVersion(
        stack.origin,
        fake.origin,
      );
      await activateRoutingPolicy(stack.origin, {
        key: "container-routing-deny",
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

      const created = await createContainerRun(
        stack.origin,
        modelProfileVersionId,
        {
          mode: "model",
          prompt: "container-k3",
        },
      );

      await waitUntil(async () => {
        const run = await fetchJson(`${stack.origin}/v1/runs/${created.runId}`);
        const status = (run.body as { status?: string }).status;
        return status === "FAILED" || status === "SUCCEEDED";
      });

      expect(fake.requests.length).toBe(0);
      expect((await listReservations(database, WORKSPACE_ID)).length).toBe(0);
    } finally {
      await stack.stop();
      await fake.close();
    }
  }, 120_000);

  it("K7: budget disabled — container echo unchanged", async () => {
    const fake = await startFakeOpenAIResponsesServer();
    const stack = await startStack(fake.origin);
    try {
      await seedBudget(10_000_000);
      const modelProfileVersionId = await createModelProfileVersion(
        stack.origin,
        fake.origin,
      );
      const created = await createContainerRun(
        stack.origin,
        modelProfileVersionId,
        {
          mode: "echo",
          value: "k7",
        },
      );

      await waitUntil(async () => {
        const run = await fetchJson(`${stack.origin}/v1/runs/${created.runId}`);
        return (run.body as { status?: string }).status === "SUCCEEDED";
      });

      expect((await listReservations(database, WORKSPACE_ID)).length).toBe(0);
    } finally {
      await stack.stop();
      await fake.close();
    }
  }, 120_000);

  it("K4: missing capability bridge — zero provider HTTP", async () => {
    const fake = await startFakeOpenAIResponsesServer();
    const trustedRuntimeRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), "osva-container-k4-"),
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
        OSVA_CONTAINER_ENABLED: "true",
        OSVA_CONTAINER_NETWORK_MODE: "bridge",
        OPENAI_API_KEY: "test-key",
      },
      (connectionString) => createDatabase({ connectionString, max: 5 }),
      {
        openai: {
          apiKey: "test-key",
          baseURL: fake.origin.endsWith("/v1")
            ? fake.origin
            : `${fake.origin}/v1`,
          maxRetries: 0,
        },
      },
    );
    try {
      const port = await web.listen();
      await worker.start();
      const origin = `http://127.0.0.1:${String(port)}`;
      const modelProfileVersionId = await createModelProfileVersion(
        origin,
        fake.origin,
      );
      await seedAndActivateBudget(
        origin,
        modelProfileVersionId,
        "container-routing-k4",
        10_000_000,
      );
      const created = await createContainerRun(origin, modelProfileVersionId, {
        mode: "model",
        prompt: "container-k4",
      });
      await waitUntil(async () => {
        const run = await fetchJson(`${origin}/v1/runs/${created.runId}`);
        return (run.body as { status?: string }).status === "FAILED";
      });
      expect(fake.requests.length).toBe(0);
      expect((await listReservations(database, WORKSPACE_ID)).length).toBe(0);
    } finally {
      await worker.stop();
      await web.stop();
      await assertNoOsvaManagedContainers();
      await fake.close();
    }
  }, 120_000);

  it("K5: server workspace authority — reservations bound to harness workspace", async () => {
    const fake = await startFakeOpenAIResponsesServer();
    const stack = await startStack(fake.origin, { activationApi: true });
    try {
      const modelProfileVersionId = await createModelProfileVersion(
        stack.origin,
        fake.origin,
      );
      await seedAndActivateBudget(
        stack.origin,
        modelProfileVersionId,
        "container-routing-k5",
        10_000_000,
      );
      const created = await createContainerRun(
        stack.origin,
        modelProfileVersionId,
        {
          mode: "model",
          binding: "primary",
          prompt: "container-k5",
          untrustedWorkspaceId: "ws-forged",
          untrustedPolicyVersionId: "ibpv-forged",
        },
      );
      expect(
        await waitForRunTerminal(stack.origin, database, created.runId),
      ).toBe("SUCCEEDED");
      const [runRow] = await database.sql<{ workspace_id: string }[]>`
        SELECT workspace_id FROM runs WHERE id = ${created.runId}
      `;
      expect(runRow?.workspace_id).toBe(WORKSPACE_ID);
      const reservations = await listReservations(database, WORKSPACE_ID);
      expect(reservations.length).toBeGreaterThan(0);
      const foreign = await database.sql`
        SELECT id FROM inference_budget_reservations
        WHERE workspace_id <> ${WORKSPACE_ID}
      `;
      expect(foreign.length).toBe(0);
    } finally {
      await stack.stop();
      await fake.close();
    }
  }, 180_000);

  it("K6: no unscoped provider bypass without worker credentials", async () => {
    const fake = await startFakeOpenAIResponsesServer();
    const trustedRuntimeRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), "osva-container-k6-"),
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
        OSVA_CONTAINER_ENABLED: "true",
        OSVA_RUNTIME_CAPABILITY_SECRET: CAPABILITY_SECRET,
        OSVA_CONTAINER_NETWORK_MODE: "bridge",
      },
      (connectionString) => createDatabase({ connectionString, max: 5 }),
      {},
    );
    try {
      const port = await web.listen();
      await worker.start();
      const origin = `http://127.0.0.1:${String(port)}`;
      const modelProfileVersionId = await createModelProfileVersion(
        origin,
        fake.origin,
      );
      await seedAndActivateBudget(
        origin,
        modelProfileVersionId,
        "container-routing-k6",
        10_000_000,
      );
      const created = await createContainerRun(origin, modelProfileVersionId, {
        mode: "model",
        prompt: "container-k6",
      });
      await waitUntil(async () => {
        const run = await fetchJson(`${origin}/v1/runs/${created.runId}`);
        return (run.body as { status?: string }).status === "FAILED";
      });
      expect(fake.requests.length).toBe(0);
    } finally {
      await worker.stop();
      await web.stop();
      await assertNoOsvaManagedContainers();
      await fake.close();
    }
  }, 120_000);

  it("K8: post-startup activation enforced on subsequent container model run", async () => {
    const fake = await startFakeOpenAIResponsesServer();
    const stack = await startStack(fake.origin, { activationApi: true });
    try {
      await seedBudget(10_000_000);
      const modelProfileVersionId = await createModelProfileVersion(
        stack.origin,
        fake.origin,
      );

      const before = await createContainerRun(
        stack.origin,
        modelProfileVersionId,
        {
          mode: "echo",
          value: "pre-activation",
        },
      );
      await waitUntil(async () => {
        const run = await fetchJson(`${stack.origin}/v1/runs/${before.runId}`);
        return (run.body as { status?: string }).status === "SUCCEEDED";
      });
      expect((await listReservations(database, WORKSPACE_ID)).length).toBe(0);

      await activateRoutingPolicy(stack.origin, {
        key: "container-routing-k8",
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

      const after = await createContainerRun(
        stack.origin,
        modelProfileVersionId,
        {
          mode: "model",
          prompt: "container-k8",
        },
      );
      expect(
        await waitForRunTerminal(stack.origin, database, after.runId),
      ).toBe("SUCCEEDED");
      expect(fake.requests.length).toBe(1);
      expect(
        (await listReservations(database, WORKSPACE_ID)).length,
      ).toBeGreaterThan(0);
    } finally {
      await stack.stop();
      await fake.close();
    }
  }, 180_000);

  it("K9: container runtime protocol streaming", () => {
    expect(RUNTIME_CAPABILITY_PATHS.generateText).toBe(
      "/v1/runtime/capabilities/models/generate-text",
    );
    expect(
      Object.values(RUNTIME_CAPABILITY_PATHS).some((path) =>
        path.includes("stream"),
      ),
    ).toBe(false);
  });

  it("K10: provider failure after start retains liability without duplicate I/O", async () => {
    const fake = await startFakeOpenAIResponsesServer();
    const stack = await startStack(fake.origin, { activationApi: true });
    try {
      const modelProfileVersionId = await createModelProfileVersion(
        stack.origin,
        fake.origin,
        "gpt-routing-retry-429",
      );
      await seedAndActivateBudget(
        stack.origin,
        modelProfileVersionId,
        "container-routing-k10",
        10_000_000,
      );
      const created = await createContainerRun(
        stack.origin,
        modelProfileVersionId,
        {
          mode: "model",
          prompt: "container-k10",
        },
      );
      await waitUntil(async () => {
        const run = await fetchJson(`${stack.origin}/v1/runs/${created.runId}`);
        const status = (run.body as { status?: string }).status;
        return status === "FAILED" || status === "SUCCEEDED";
      });
      const terminal = await fetchJson(
        `${stack.origin}/v1/runs/${created.runId}`,
      );
      expect((terminal.body as { status?: string }).status).toBe("FAILED");
      expect(fake.requests.length).toBe(1);
      const rows = await listReservations(database, WORKSPACE_ID);
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.every((r) => r.status === "RELEASED")).toBe(false);
      expect(
        rows.some(
          (r) =>
            r.status === "RECONCILIATION_REQUIRED" ||
            r.status === "PROVIDER_STARTED" ||
            r.uncertain_floor_usd_micros !== null,
        ),
      ).toBe(true);
      const ledger = await readPeriodLedger(
        database,
        WORKSPACE_ID,
        periodKeyFor(NOW),
      );
      if (ledger !== null) {
        expect(
          ledger.unresolved_uncertain_liability_usd_micros +
            ledger.held_reservations_usd_micros,
        ).toBeGreaterThan(0);
      }
    } finally {
      await stack.stop();
      await fake.close();
    }
  }, 180_000);
});
