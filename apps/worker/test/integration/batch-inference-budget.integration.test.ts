/**
 * B5.5B.2 — Native batch inference budget acceptance (B1–B18 subset).
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  createDatabase,
  migrateDatabase,
  PostgresWorkspaceRepository,
  type Database,
} from "@osva/db";
import { Workspace } from "@osva/domain";
import { sha256IntegrityOf } from "@osva/adapters-runtime-typescript";

import { startFakeOpenAiBatchServer } from "../../../../adapters/model-openai/test/fake-openai-batch-server.js";
import { withTestAuthEnv } from "../../../../packages/db/test/integration/web-auth-env.js";
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
import { createWebProcess } from "../../../../apps/web/src/process.js";
import { createWorkerProcess } from "../../src/process.js";
import {
  BATCH_BUDGET_WS,
  BATCH_BUDGET_WS_B,
  buildBatchCreateBody,
  createBudgetedBatchBundle,
  enableBatchInference,
  listBudgetReservations,
  seedOpenAiBatchBinding,
  seedWorkspaceInferenceBudget,
  waitForJobTerminal,
  waitUntil,
} from "./batch-inference-budget-harness.js";

const NOW = new Date("2026-03-10T12:00:00.000Z");
const FIXTURE_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../adapters/runtime-typescript/test/fixtures",
);

async function prepareTrustedRuntimeRoot(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "osva-batch-budget-"));
  const file = "model-text-agent.ts";
  await fs.copyFile(path.join(FIXTURE_DIR, file), path.join(root, file));
  sha256IntegrityOf(await fs.readFile(path.join(root, file)));
  return root;
}

async function startBudgetWorkerStack(input: {
  readonly postgres: PostgresTestContext;
  readonly valkey: ValkeyTestContext;
  readonly fakeOrigin: string;
  readonly deferWorkerStart?: boolean;
}) {
  const deferWorkerStart = input.deferWorkerStart === true;
  const trustedRuntimeRoot = await prepareTrustedRuntimeRoot();
  const web = createWebProcess(
    withTestAuthEnv({
      OSVA_DATABASE_URL: input.postgres.connectionString,
      OSVA_VALKEY_URL: input.valkey.url,
      OSVA_WEB_HOST: "127.0.0.1",
      OSVA_WEB_PORT: "0",
    }),
  );
  const worker = createWorkerProcess(
    {
      OSVA_DATABASE_URL: input.postgres.connectionString,
      OSVA_VALKEY_URL: input.valkey.url,
      OSVA_EXECUTION_RECOVERY_POLL_MS: "200",
      OSVA_TRUSTED_RUNTIME_ROOT: trustedRuntimeRoot,
      OPENAI_API_KEY: "test-key",
    },
    (connectionString) => createDatabase({ connectionString, max: 6 }),
    {
      openai: {
        apiKey: "test-key",
        baseURL: `${input.fakeOrigin}/v1`,
        maxRetries: 0,
      },
    },
  );
  const port = await web.listen();
  let workerStarted = false;
  if (!deferWorkerStart) {
    await worker.start();
    workerStarted = true;
  }
  return {
    origin: `http://127.0.0.1:${String(port)}`,
    worker,
    async startWorker() {
      if (!workerStarted) {
        await worker.start();
        workerStarted = true;
      }
    },
    async shutdown() {
      if (workerStarted) {
        await worker.stop();
      }
      await web.stop();
    },
  };
}

describe("B5.5B.2 batch inference budget acceptance", () => {
  let postgres: PostgresTestContext;
  let valkey: ValkeyTestContext;
  let database: Database;

  beforeAll(async () => {
    postgres = await startPostgresForTests();
    valkey = await startValkeyForTests();
    database = createDatabase({
      connectionString: postgres.connectionString,
      max: 6,
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
    await bootstrapIntegrationAuth(
      database,
      BATCH_BUDGET_WS,
      NOW,
      "Batch Budget",
    );
    await enableBatchInference(database, BATCH_BUDGET_WS);
  });

  it("B1/B3: all items admitted; PROVIDER_STARTED before provider batch submit", async () => {
    await seedWorkspaceInferenceBudget(database, {
      workspaceId: BATCH_BUDGET_WS,
      periodLimitUsdMicros: 50_000_000,
      enabled: true,
      now: NOW,
    });
    const fake = await startFakeOpenAiBatchServer({ submitDelayMs: 2_500 });
    const stack = await startBudgetWorkerStack({
      postgres,
      valkey,
      fakeOrigin: fake.origin,
      deferWorkerStart: true,
    });
    try {
      const binding = await seedOpenAiBatchBinding(stack.origin, fake.origin);
      const created = await fetchJson(
        `${stack.origin}/v1/batch-inference-jobs`,
        {
          method: "POST",
          body: buildBatchCreateBody({
            workspaceId: BATCH_BUDGET_WS,
            ...binding,
            fingerprint: "fp-batch-budget-b1b3",
            items: [
              { providerCorrelationId: "c_a", content: "one" },
              { providerCorrelationId: "c_b", content: "two" },
            ],
          }),
        },
      );
      expect(created.status).toBe(201);
      const jobId = (created.body as { job: { id: string } }).job.id;
      await stack.startWorker();
      await waitUntil(async () => {
        const rows = await listBudgetReservations(database, BATCH_BUDGET_WS);
        const allProviderStarted =
          rows.length >= 2 && rows.every((r) => r.provider_started_at !== null);
        if (allProviderStarted && fake.batchCreateCount() === 0) {
          return true;
        }
        if (fake.batchCreateCount() > 0) {
          throw new Error(
            "provider batch submit began before PROVIDER_STARTED",
          );
        }
        return false;
      }, 90_000);
      await waitForJobTerminal(stack.origin, jobId);
      expect(fake.batchCreateCount()).toBe(1);
      expect(
        (await listBudgetReservations(database, BATCH_BUDGET_WS)).length,
      ).toBe(2);
    } finally {
      await stack.shutdown();
      await fake.close();
    }
  }, 120_000);

  it("B2: budget denial → zero provider batch submit", async () => {
    await seedWorkspaceInferenceBudget(database, {
      workspaceId: BATCH_BUDGET_WS,
      periodLimitUsdMicros: 100,
      enabled: true,
      now: NOW,
    });
    const fake = await startFakeOpenAiBatchServer();
    const stack = await startBudgetWorkerStack({
      postgres,
      valkey,
      fakeOrigin: fake.origin,
    });
    try {
      const binding = await seedOpenAiBatchBinding(stack.origin, fake.origin);
      const created = await fetchJson(
        `${stack.origin}/v1/batch-inference-jobs`,
        {
          method: "POST",
          body: buildBatchCreateBody({
            workspaceId: BATCH_BUDGET_WS,
            ...binding,
            fingerprint: "fp-batch-budget-b2",
            items: [{ providerCorrelationId: "c_deny", content: "deny" }],
          }),
        },
      );
      expect(created.status).toBe(201);
      const jobId = (created.body as { job: { id: string } }).job.id;
      const terminal = await waitForJobTerminal(stack.origin, jobId);
      expect(terminal.status).toBe("SUBMITTING");
      expect(terminal.reconciliationRequired).toBe(true);
      expect(fake.batchCreateCount()).toBe(0);
      const rows = await listBudgetReservations(database, BATCH_BUDGET_WS);
      expect(rows.every((r) => r.status !== "PROVIDER_STARTED")).toBe(true);
    } finally {
      await stack.shutdown();
      await fake.close();
    }
  }, 90_000);

  it("B4: partial admission failure → no submit; prior holds released", async () => {
    await seedWorkspaceInferenceBudget(database, {
      workspaceId: BATCH_BUDGET_WS,
      periodLimitUsdMicros: 1_500,
      enabled: true,
      now: NOW,
    });
    const fake = await startFakeOpenAiBatchServer();
    const stack = await startBudgetWorkerStack({
      postgres,
      valkey,
      fakeOrigin: fake.origin,
    });
    try {
      const binding = await seedOpenAiBatchBinding(stack.origin, fake.origin);
      const created = await fetchJson(
        `${stack.origin}/v1/batch-inference-jobs`,
        {
          method: "POST",
          body: buildBatchCreateBody({
            workspaceId: BATCH_BUDGET_WS,
            ...binding,
            fingerprint: "fp-batch-budget-b4",
            items: [
              { providerCorrelationId: "c_small", content: "tiny" },
              {
                providerCorrelationId: "c_big",
                content: "x".repeat(8_000),
              },
            ],
          }),
        },
      );
      expect(created.status).toBe(201);
      const jobId = (created.body as { job: { id: string } }).job.id;
      const terminal = await waitForJobTerminal(stack.origin, jobId);
      expect(terminal.reconciliationRequired).toBe(true);
      expect(fake.batchCreateCount()).toBe(0);
      const rows = await listBudgetReservations(database, BATCH_BUDGET_WS);
      expect(rows.length).toBeLessThanOrEqual(1);
    } finally {
      await stack.shutdown();
      await fake.close();
    }
  }, 90_000);

  it("B6: concurrent processor ticks authorize a single provider submit", async () => {
    await seedWorkspaceInferenceBudget(database, {
      workspaceId: BATCH_BUDGET_WS,
      periodLimitUsdMicros: 50_000_000,
      enabled: true,
      now: NOW,
    });
    const fake = await startFakeOpenAiBatchServer();
    const bundleA = createBudgetedBatchBundle({
      database,
      workerId: "worker-a-b6",
    });
    const bundleB = createBudgetedBatchBundle({
      database,
      workerId: "worker-b-b6",
    });
    const stack = await startBudgetWorkerStack({
      postgres,
      valkey,
      fakeOrigin: fake.origin,
    });
    try {
      const binding = await seedOpenAiBatchBinding(stack.origin, fake.origin);
      const created = await fetchJson(
        `${stack.origin}/v1/batch-inference-jobs`,
        {
          method: "POST",
          body: buildBatchCreateBody({
            workspaceId: BATCH_BUDGET_WS,
            ...binding,
            fingerprint: "fp-batch-budget-b6",
            items: [{ providerCorrelationId: "c6", content: "dup" }],
          }),
        },
      );
      expect(created.status).toBe(201);
      await Promise.all([
        bundleA.processor.execute({ batchLimit: 2 }),
        bundleB.processor.execute({ batchLimit: 2 }),
      ]);
      await waitForJobTerminal(
        stack.origin,
        (created.body as { job: { id: string } }).job.id,
      );
      expect(fake.batchCreateCount()).toBe(1);
    } finally {
      await stack.shutdown();
      await fake.close();
    }
  }, 90_000);

  it("B-A4: provider submit failure retains uncertain batch liability", async () => {
    await seedWorkspaceInferenceBudget(database, {
      workspaceId: BATCH_BUDGET_WS,
      periodLimitUsdMicros: 50_000_000,
      enabled: true,
      now: NOW,
    });
    const fake = await startFakeOpenAiBatchServer({ failBatchSubmit: true });
    const stack = await startBudgetWorkerStack({
      postgres,
      valkey,
      fakeOrigin: fake.origin,
    });
    try {
      const binding = await seedOpenAiBatchBinding(stack.origin, fake.origin);
      const created = await fetchJson(
        `${stack.origin}/v1/batch-inference-jobs`,
        {
          method: "POST",
          body: buildBatchCreateBody({
            workspaceId: BATCH_BUDGET_WS,
            ...binding,
            fingerprint: "fp-batch-budget-amb",
            items: [{ providerCorrelationId: "c_amb", content: "amb" }],
          }),
        },
      );
      expect(created.status).toBe(201);
      const jobId = (created.body as { job: { id: string } }).job.id;
      const terminal = await waitForJobTerminal(stack.origin, jobId);
      expect(terminal.reconciliationRequired).toBe(true);
      const rows = await listBudgetReservations(database, BATCH_BUDGET_WS);
      expect(rows.some((r) => r.status === "RECONCILIATION_REQUIRED")).toBe(
        true,
      );
      expect(fake.batchCreateCount()).toBe(0);
      const bundle = createBudgetedBatchBundle({ database });
      await bundle.processor.execute({ batchLimit: 2 });
      expect(fake.batchCreateCount()).toBe(0);
    } finally {
      await stack.shutdown();
      await fake.close();
    }
  }, 90_000);

  it("B9: successful batch reconciles COMMITTED reservations per item", async () => {
    await seedWorkspaceInferenceBudget(database, {
      workspaceId: BATCH_BUDGET_WS,
      periodLimitUsdMicros: 50_000_000,
      enabled: true,
      now: NOW,
    });
    const fake = await startFakeOpenAiBatchServer();
    const stack = await startBudgetWorkerStack({
      postgres,
      valkey,
      fakeOrigin: fake.origin,
    });
    try {
      const binding = await seedOpenAiBatchBinding(stack.origin, fake.origin);
      const created = await fetchJson(
        `${stack.origin}/v1/batch-inference-jobs`,
        {
          method: "POST",
          body: buildBatchCreateBody({
            workspaceId: BATCH_BUDGET_WS,
            ...binding,
            fingerprint: "fp-batch-budget-b9",
            items: [
              { providerCorrelationId: "ok_a", content: "hello" },
              { providerCorrelationId: "ok_b", content: "world" },
            ],
          }),
        },
      );
      expect(created.status).toBe(201);
      const jobId = (created.body as { job: { id: string } }).job.id;
      const terminal = await waitForJobTerminal(stack.origin, jobId);
      expect(terminal.status).toBe("COMPLETED");
      const rows = await listBudgetReservations(database, BATCH_BUDGET_WS);
      expect(rows).toHaveLength(2);
      expect(rows.every((r) => r.status === "COMMITTED")).toBe(true);
      expect(rows.every((r) => (r.committed_usd_micros ?? 0) > 0)).toBe(true);
    } finally {
      await stack.shutdown();
      await fake.close();
    }
  }, 90_000);

  it("B10: mixed provider item failure still commits succeeded item liability", async () => {
    await seedWorkspaceInferenceBudget(database, {
      workspaceId: BATCH_BUDGET_WS,
      periodLimitUsdMicros: 50_000_000,
      enabled: true,
      now: NOW,
    });
    const fake = await startFakeOpenAiBatchServer({
      failItemCorrelationIds: ["fail_b10"],
    });
    const stack = await startBudgetWorkerStack({
      postgres,
      valkey,
      fakeOrigin: fake.origin,
    });
    try {
      const binding = await seedOpenAiBatchBinding(stack.origin, fake.origin);
      const created = await fetchJson(
        `${stack.origin}/v1/batch-inference-jobs`,
        {
          method: "POST",
          body: buildBatchCreateBody({
            workspaceId: BATCH_BUDGET_WS,
            ...binding,
            fingerprint: "fp-batch-budget-b10",
            items: [
              { providerCorrelationId: "ok_b10", content: "ok" },
              { providerCorrelationId: "fail_b10", content: "fail" },
            ],
          }),
        },
      );
      expect(created.status).toBe(201);
      const jobId = (created.body as { job: { id: string } }).job.id;
      const terminal = await waitForJobTerminal(stack.origin, jobId);
      expect(terminal.status).toBe("PARTIALLY_COMPLETED");
      const rows = await listBudgetReservations(database, BATCH_BUDGET_WS);
      expect(rows).toHaveLength(2);
      expect(
        rows.filter((r) => r.status === "COMMITTED").length,
      ).toBeGreaterThan(0);
    } finally {
      await stack.shutdown();
      await fake.close();
    }
  }, 90_000);

  it("B14: repeated reconcile ticks are idempotent on terminal items", async () => {
    await seedWorkspaceInferenceBudget(database, {
      workspaceId: BATCH_BUDGET_WS,
      periodLimitUsdMicros: 50_000_000,
      enabled: true,
      now: NOW,
    });
    const fake = await startFakeOpenAiBatchServer();
    const stack = await startBudgetWorkerStack({
      postgres,
      valkey,
      fakeOrigin: fake.origin,
    });
    const bundle = createBudgetedBatchBundle({ database });
    try {
      const binding = await seedOpenAiBatchBinding(stack.origin, fake.origin);
      const created = await fetchJson(
        `${stack.origin}/v1/batch-inference-jobs`,
        {
          method: "POST",
          body: buildBatchCreateBody({
            workspaceId: BATCH_BUDGET_WS,
            ...binding,
            fingerprint: "fp-batch-budget-b14",
            items: [{ providerCorrelationId: "c14", content: "idem" }],
          }),
        },
      );
      expect(created.status).toBe(201);
      const jobId = (created.body as { job: { id: string } }).job.id;
      await waitForJobTerminal(stack.origin, jobId);
      const before = await listBudgetReservations(database, BATCH_BUDGET_WS);
      await bundle.processor.execute({ batchLimit: 3 });
      await bundle.processor.execute({ batchLimit: 3 });
      const after = await listBudgetReservations(database, BATCH_BUDGET_WS);
      expect(after).toEqual(before);
    } finally {
      await stack.shutdown();
      await fake.close();
    }
  }, 90_000);

  it("B18: cross-workspace cannot observe budget reservations", async () => {
    await seedWorkspaceInferenceBudget(database, {
      workspaceId: BATCH_BUDGET_WS,
      periodLimitUsdMicros: 50_000_000,
      enabled: true,
      now: NOW,
    });
    await new PostgresWorkspaceRepository(database).save(
      Workspace.create({
        id: BATCH_BUDGET_WS_B,
        name: "Batch Budget B",
        createdAt: NOW,
      }),
    );
    const fake = await startFakeOpenAiBatchServer();
    const stack = await startBudgetWorkerStack({
      postgres,
      valkey,
      fakeOrigin: fake.origin,
    });
    try {
      const binding = await seedOpenAiBatchBinding(stack.origin, fake.origin);
      const created = await fetchJson(
        `${stack.origin}/v1/batch-inference-jobs`,
        {
          method: "POST",
          body: buildBatchCreateBody({
            workspaceId: BATCH_BUDGET_WS,
            ...binding,
            fingerprint: "fp-batch-budget-b18",
            items: [{ providerCorrelationId: "c18", content: "iso" }],
          }),
        },
      );
      expect(created.status).toBe(201);
      const jobId = (created.body as { job: { id: string } }).job.id;
      await waitForJobTerminal(stack.origin, jobId);
      expect(
        (await listBudgetReservations(database, BATCH_BUDGET_WS)).length,
      ).toBe(1);
      expect(
        (await listBudgetReservations(database, BATCH_BUDGET_WS_B)).length,
      ).toBe(0);
    } finally {
      await stack.shutdown();
      await fake.close();
    }
  }, 90_000);
});
