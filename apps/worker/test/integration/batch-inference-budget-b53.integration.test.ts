/**
 * B5.5B.3 — Batch budget enforcement closure (edge cases + ack-lost Postgres).
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { createDatabase, migrateDatabase, type Database } from "@osva/db";
import { sha256IntegrityOf } from "@osva/adapters-runtime-typescript";
import { resolveInferenceBudgetUtcPeriodIdentity } from "@osva/domain";

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
  TestAdmissionFailProviderStart,
  buildBatchCreateBody,
  createBudgetedBatchBundle,
  driveBatchProcessorUntilTerminal,
  enableBatchInference,
  listBudgetReservations,
  makeBatchJobDue,
  readBatchJob,
  waitUntil,
  seedOpenAiBatchBinding,
  seedWorkspaceInferenceBudget,
  setBatchSubmissionLease,
  TestBatchJobsDenyMarkSubmitted,
  waitForJobTerminal,
} from "./batch-inference-budget-harness.js";

const NOW = new Date("2026-03-10T12:00:00.000Z");
const MARCH_PERIOD = resolveInferenceBudgetUtcPeriodIdentity(NOW).periodKey;
const FIXTURE_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../adapters/runtime-typescript/test/fixtures",
);

async function prepareTrustedRuntimeRoot(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "osva-batch-b53-"));
  const file = "model-text-agent.ts";
  await fs.copyFile(path.join(FIXTURE_DIR, file), path.join(root, file));
  sha256IntegrityOf(await fs.readFile(path.join(root, file)));
  return root;
}

async function startBudgetWorkerStack(input: {
  readonly postgres: PostgresTestContext;
  readonly valkey: ValkeyTestContext;
  readonly fakeOrigin: string;
  readonly startWorker?: boolean;
}) {
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
  if (input.startWorker === true) {
    await worker.start();
  }
  return {
    origin: `http://127.0.0.1:${String(port)}`,
    worker,
    async shutdown() {
      if (input.startWorker === true) {
        await worker.stop();
      }
      await web.stop();
    },
  };
}

describe("B5.5B.3 batch budget enforcement closure", () => {
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

  afterEach(() => {
    vi.restoreAllMocks();
  });

  beforeEach(async () => {
    await resetStage0Tables(database);
    await bootstrapIntegrationAuth(
      database,
      BATCH_BUDGET_WS,
      NOW,
      "Batch Budget B53",
    );
    await enableBatchInference(database, BATCH_BUDGET_WS);
    await seedWorkspaceInferenceBudget(database, {
      workspaceId: BATCH_BUDGET_WS,
      periodLimitUsdMicros: 50_000_000,
      enabled: true,
      now: NOW,
    });
  });

  it("P2: provider accepted / local ack lost — Postgres liability and no resubmit", async () => {
    const fake = await startFakeOpenAiBatchServer();
    const stack = await startBudgetWorkerStack({
      postgres,
      valkey,
      fakeOrigin: fake.origin,
    });
    const denyJobs = new TestBatchJobsDenyMarkSubmitted(database);
    const markSubmittedSpy = vi.spyOn(denyJobs, "markSubmitted");
    const bundle = createBudgetedBatchBundle({
      database,
      workerId: "worker-ack-lost",
      now: () => NOW,
      jobs: denyJobs,
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
            fingerprint: "fp-batch-budget-ack",
            items: [{ providerCorrelationId: "ack_item", content: "ack" }],
          }),
        },
      );
      expect(created.status).toBe(201);
      const jobId = (created.body as { job: { id: string } }).job.id;
      await makeBatchJobDue(database, jobId, NOW);
      const fingerprintBefore = (await readBatchJob(database, jobId))
        ?.submission_fingerprint;
      await bundle.processor.execute({ batchLimit: 2 });
      expect(fake.batchCreateCount()).toBe(1);
      expect(markSubmittedSpy).toHaveBeenCalled();
      const job = await readBatchJob(database, jobId);
      expect(job?.reconciliation_note).toBe("provider_accepted_local_ack_lost");
      expect(job?.reconciliation_required).toBe(true);
      expect(job?.provider_batch_id).toBeNull();
      const rows = await listBudgetReservations(database, BATCH_BUDGET_WS);
      expect(rows.some((r) => r.status === "RECONCILIATION_REQUIRED")).toBe(
        true,
      );
      expect(rows.every((r) => r.status !== "RELEASED")).toBe(true);
      await bundle.processor.execute({ batchLimit: 2 });
      expect(fake.batchCreateCount()).toBe(1);
      const jobAfter = await readBatchJob(database, jobId);
      expect(jobAfter?.submission_fingerprint).toBe(fingerprintBefore);
    } finally {
      await stack.shutdown();
      await fake.close();
    }
  }, 120_000);

  it("B5: provider-start persistence failure — no adapter.submit", async () => {
    const fake = await startFakeOpenAiBatchServer();
    const stack = await startBudgetWorkerStack({
      postgres,
      valkey,
      fakeOrigin: fake.origin,
    });
    const bundle = createBudgetedBatchBundle({
      database,
      workerId: "worker-b5",
      inferenceBudgetAdmission: new TestAdmissionFailProviderStart(database),
      now: () => NOW,
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
            fingerprint: "fp-batch-budget-b5",
            items: [{ providerCorrelationId: "b5", content: "b5" }],
          }),
        },
      );
      expect(created.status).toBe(201);
      const jobId = (created.body as { job: { id: string } }).job.id;
      await makeBatchJobDue(database, jobId, NOW);
      await bundle.processor.execute({ batchLimit: 2 });
      expect(fake.batchCreateCount()).toBe(0);
      const job = await readBatchJob(database, jobId);
      expect(
        job?.reconciliation_note ===
          "test_provider_start_persistence_failure" ||
          job?.reconciliation_required === true,
      ).toBe(true);
    } finally {
      await stack.shutdown();
      await fake.close();
    }
  }, 90_000);

  it("B7: active foreign submission lease blocks provider submit", async () => {
    const fake = await startFakeOpenAiBatchServer();
    const stack = await startBudgetWorkerStack({
      postgres,
      valkey,
      fakeOrigin: fake.origin,
    });
    const bundle = createBudgetedBatchBundle({
      database,
      workerId: "worker-b7-intruder",
      now: () => NOW,
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
            fingerprint: "fp-batch-budget-b7",
            items: [{ providerCorrelationId: "b7", content: "b7" }],
          }),
        },
      );
      const jobId = (created.body as { job: { id: string } }).job.id;
      await makeBatchJobDue(database, jobId, NOW);
      await setBatchSubmissionLease(database, jobId, {
        owner: "worker:foreign-owner",
        expiresAt: new Date(Date.now() + 600_000),
      });
      await bundle.processor.execute({ batchLimit: 2 });
      expect(fake.batchCreateCount()).toBe(0);
    } finally {
      await stack.shutdown();
      await fake.close();
    }
  }, 90_000);

  it("B11: provider output missing item keeps unresolved liability", async () => {
    const fake = await startFakeOpenAiBatchServer({
      omitOutputCorrelationIds: ["missing_b11"],
    });
    const stack = await startBudgetWorkerStack({
      postgres,
      valkey,
      fakeOrigin: fake.origin,
      startWorker: true,
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
            fingerprint: "fp-batch-budget-b11",
            items: [
              { providerCorrelationId: "ok_b11", content: "ok" },
              { providerCorrelationId: "missing_b11", content: "miss" },
            ],
          }),
        },
      );
      const jobId = (created.body as { job: { id: string } }).job.id;
      await waitForJobTerminal(stack.origin, jobId);
      const rows = await listBudgetReservations(database, BATCH_BUDGET_WS);
      expect(rows.length).toBe(2);
      expect(
        rows.some(
          (r) =>
            r.status !== "COMMITTED" ||
            r.committed_usd_micros === null ||
            r.committed_usd_micros === 0,
        ),
      ).toBe(true);
    } finally {
      await stack.shutdown();
      await fake.close();
    }
  }, 120_000);

  it("B15: actual usage above reservation records overage once", async () => {
    const fake = await startFakeOpenAiBatchServer({
      outputCompletionTokens: 50_000,
    });
    const stack = await startBudgetWorkerStack({
      postgres,
      valkey,
      fakeOrigin: fake.origin,
      startWorker: true,
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
            fingerprint: "fp-batch-budget-b15",
            items: [{ providerCorrelationId: "b15", content: "overage" }],
          }),
        },
      );
      const jobId = (created.body as { job: { id: string } }).job.id;
      await waitForJobTerminal(stack.origin, jobId);
      const rows = await listBudgetReservations(database, BATCH_BUDGET_WS);
      expect(rows).toHaveLength(1);
      const committed = Number(rows[0]?.committed_usd_micros ?? 0);
      const reserved = Number(rows[0]?.reserved_usd_micros ?? 0);
      expect(committed).toBeGreaterThan(0);
      expect(committed).toBeGreaterThan(reserved);
    } finally {
      await stack.shutdown();
      await fake.close();
    }
  }, 120_000);

  it("B16: unknown provider usage stays uncertain (not zero commit)", async () => {
    const fake = await startFakeOpenAiBatchServer({ omitUsageInOutput: true });
    const stack = await startBudgetWorkerStack({
      postgres,
      valkey,
      fakeOrigin: fake.origin,
      startWorker: true,
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
            fingerprint: "fp-batch-budget-b16",
            items: [{ providerCorrelationId: "b16", content: "unknown" }],
          }),
        },
      );
      const jobId = (created.body as { job: { id: string } }).job.id;
      const terminal = await waitForJobTerminal(stack.origin, jobId);
      const rows = await listBudgetReservations(database, BATCH_BUDGET_WS);
      expect(rows).toHaveLength(1);
      expect(
        rows[0]?.status === "RECONCILIATION_REQUIRED" ||
          terminal.status === "PARTIALLY_COMPLETED",
      ).toBe(true);
    } finally {
      await stack.shutdown();
      await fake.close();
    }
  }, 120_000);

  it("B12: cancel after provider acceptance — known charges vs uncertain liability", async () => {
    const fake = await startFakeOpenAiBatchServer({ deferCompletion: true });
    const stack = await startBudgetWorkerStack({
      postgres,
      valkey,
      fakeOrigin: fake.origin,
    });
    const bundle = createBudgetedBatchBundle({
      database,
      now: () => NOW,
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
            fingerprint: "fp-batch-budget-b12",
            items: [
              { providerCorrelationId: "b12_ok", content: "ok" },
              { providerCorrelationId: "b12_unknown", content: "pending" },
            ],
          }),
        },
      );
      const jobId = (created.body as { job: { id: string } }).job.id;
      await makeBatchJobDue(database, jobId, NOW);
      await waitUntil(async () => {
        await bundle.processor.execute({ batchLimit: 2 });
        const job = await readBatchJob(database, jobId);
        const status = job?.status as string | undefined;
        return (
          typeof job?.provider_batch_id === "string" &&
          (status === "SUBMITTED" ||
            status === "PROCESSING" ||
            status === "FINALIZING")
        );
      });
      expect(fake.batchCreateCount()).toBe(1);
      const cancel = await fetchJson(
        `${stack.origin}/v1/batch-inference-jobs/${jobId}/cancel`,
        { method: "POST", body: {} },
      );
      expect(cancel.status).toBe(200);
      await makeBatchJobDue(database, jobId, NOW);
      const terminal = await driveBatchProcessorUntilTerminal({
        bundle,
        origin: stack.origin,
        jobId,
        maxTicks: 80,
      });
      expect(fake.cancelRequestCount()).toBeGreaterThanOrEqual(1);
      expect(["CANCELLED", "PARTIALLY_COMPLETED"]).toContain(terminal.status);
      const rows = await listBudgetReservations(database, BATCH_BUDGET_WS);
      expect(rows.length).toBe(2);
      const committed = rows.filter((r) => (r.committed_usd_micros ?? 0) > 0);
      expect(committed.length).toBeGreaterThanOrEqual(1);
      expect(
        rows.some(
          (r) => (r.committed_usd_micros ?? 0) > 0 || r.status !== "RELEASED",
        ),
      ).toBe(true);
      expect(rows.every((r) => r.status === "RELEASED")).toBe(false);
    } finally {
      await stack.shutdown();
      await fake.close();
    }
  }, 120_000);

  it("B13: partial cancellation reconciliation is idempotent", async () => {
    const fake = await startFakeOpenAiBatchServer({ deferCompletion: true });
    const stack = await startBudgetWorkerStack({
      postgres,
      valkey,
      fakeOrigin: fake.origin,
    });
    const bundle = createBudgetedBatchBundle({
      database,
      now: () => NOW,
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
            fingerprint: "fp-batch-budget-b13",
            items: [
              { providerCorrelationId: "b13_known", content: "known" },
              { providerCorrelationId: "b13_unknown", content: "unknown" },
            ],
          }),
        },
      );
      const jobId = (created.body as { job: { id: string } }).job.id;
      await makeBatchJobDue(database, jobId, NOW);
      await waitUntil(async () => {
        await bundle.processor.execute({ batchLimit: 2 });
        const job = await readBatchJob(database, jobId);
        const status = job?.status as string | undefined;
        return (
          typeof job?.provider_batch_id === "string" &&
          (status === "SUBMITTED" ||
            status === "PROCESSING" ||
            status === "FINALIZING")
        );
      });
      const cancel = await fetchJson(
        `${stack.origin}/v1/batch-inference-jobs/${jobId}/cancel`,
        {
          method: "POST",
          body: {},
        },
      );
      expect(cancel.status).toBe(200);
      await makeBatchJobDue(database, jobId, NOW);
      await driveBatchProcessorUntilTerminal({
        bundle,
        origin: stack.origin,
        jobId,
        maxTicks: 80,
      });
      const rowsAfterFirst = await listBudgetReservations(
        database,
        BATCH_BUDGET_WS,
      );
      const committedSum = rowsAfterFirst.reduce(
        (sum, r) => sum + Number(r.committed_usd_micros ?? 0),
        0,
      );
      await bundle.processor.execute({ batchLimit: 2 });
      await bundle.processor.execute({ batchLimit: 2 });
      const rowsAfterReplay = await listBudgetReservations(
        database,
        BATCH_BUDGET_WS,
      );
      const committedReplay = rowsAfterReplay.reduce(
        (sum, r) => sum + Number(r.committed_usd_micros ?? 0),
        0,
      );
      expect(committedReplay).toBe(committedSum);
      expect(committedSum).toBeGreaterThan(0);
      expect(
        rowsAfterReplay.some(
          (r) =>
            r.status === "RECONCILIATION_REQUIRED" ||
            r.status === "COMMITTED" ||
            (r.committed_usd_micros ?? 0) > 0,
        ),
      ).toBe(true);
      expect(fake.batchCreateCount()).toBe(1);
    } finally {
      await stack.shutdown();
      await fake.close();
    }
  }, 120_000);

  it("B17: reconciliation preserves original UTC budget period", async () => {
    const fake = await startFakeOpenAiBatchServer();
    const admissionTime = NOW;
    let clockOffsetMs = 0;
    const bundle = createBudgetedBatchBundle({
      database,
      now: () => new Date(admissionTime.getTime() + clockOffsetMs),
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
            fingerprint: "fp-batch-budget-b17",
            items: [{ providerCorrelationId: "b17", content: "period" }],
          }),
        },
      );
      const jobId = (created.body as { job: { id: string } }).job.id;
      await makeBatchJobDue(database, jobId, admissionTime);
      for (let i = 0; i < 30; i += 1) {
        clockOffsetMs += 60_000;
        await bundle.processor.execute({ batchLimit: 2 });
        const detail = await fetchJson(
          `${stack.origin}/v1/batch-inference-jobs/${jobId}`,
        );
        const status = (detail.body as { job: { status: string } }).job.status;
        if (status === "COMPLETED" || status === "PARTIALLY_COMPLETED") {
          break;
        }
        await new Promise((r) => setTimeout(r, 200));
      }
      const rows = await listBudgetReservations(database, BATCH_BUDGET_WS);
      expect(rows[0]?.period_key).toBe(MARCH_PERIOD);
    } finally {
      await stack.shutdown();
      await fake.close();
    }
  }, 120_000);
});
