import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { RunAttemptId, ScheduleId, WorkspaceId } from "@osva/contracts";
import { BullMqJobQueue } from "@osva/adapters-bullmq";
import { sha256IntegrityOf } from "@osva/adapters-runtime-typescript";
import {
  createDatabase,
  migrateDatabase,
  PostgresRunRepository,
  PostgresScheduleRepository,
  type Database,
} from "@osva/db";
import {
  bootstrapIntegrationAuth,
  fetchJson,
} from "../../../worker/test/integration/integration-auth.js";
import { createWebProcess } from "../../../web/src/process.js";
import { createWorkerProcess } from "../../../worker/src/process.js";
import { createSchedulerProcess } from "../../src/process.js";
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

const WORKSPACE_ID = "ws-scheduler-e2e" as WorkspaceId;
const FIXTURE_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../adapters/runtime-typescript/test/fixtures",
);

class GatedBullMqJobQueue extends BullMqJobQueue {
  private enqueueEnabled = false;

  enableEnqueue(): void {
    this.enqueueEnabled = true;
  }

  override async enqueue(runAttemptId: RunAttemptId): Promise<void> {
    if (!this.enqueueEnabled) {
      throw new Error("queue unavailable");
    }

    await super.enqueue(runAttemptId);
  }
}

describe("scheduler end-to-end", () => {
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
    if (database) {
      await database.close();
    }
    if (postgres) {
      await stopPostgresForTests(postgres);
    }
    if (valkey) {
      await stopValkeyForTests(valkey);
    }
  });

  beforeEach(async () => {
    await resetStage0Tables(database);
    await bootstrapIntegrationAuth(
      database,
      WORKSPACE_ID,
      new Date("2026-01-15T12:00:00.000Z"),
    );
  });

  it("materializes a due schedule, dispatches a run, and executes through the trusted runtime", async () => {
    const trustedRuntimeRoot = await prepareEchoAgentFixture();
    const queue = new BullMqJobQueue({ url: valkey.url });
    const web = createWebProcess(
      {
        OSVA_DATABASE_URL: postgres.connectionString,
        OSVA_VALKEY_URL: valkey.url,
        OSVA_WEB_HOST: "127.0.0.1",
        OSVA_WEB_PORT: "0",
      },
      (connectionString) => createDatabase({ connectionString, max: 5 }),
      () => queue,
    );

    let worker: ReturnType<typeof createWorkerProcess> | undefined;
    let scheduler: ReturnType<typeof createSchedulerProcess> | undefined;

    try {
      const port = await web.listen();
      const origin = `http://127.0.0.1:${String(port)}`;
      const registered = await createEchoSchedule(origin, trustedRuntimeRoot);
      const tickAt = registered.nextRunAt;
      const clock = { now: () => tickAt };

      worker = createWorkerProcess(
        {
          OSVA_DATABASE_URL: postgres.connectionString,
          OSVA_VALKEY_URL: valkey.url,
          OSVA_TRUSTED_RUNTIME_ROOT: trustedRuntimeRoot,
        },
        (connectionString) => createDatabase({ connectionString, max: 5 }),
        { queueFactory: () => queue, clock },
      );
      scheduler = createSchedulerProcess(
        {
          OSVA_DATABASE_URL: postgres.connectionString,
          OSVA_VALKEY_URL: valkey.url,
        },
        (connectionString) => createDatabase({ connectionString, max: 5 }),
        { queueFactory: () => queue, clock },
      );

      await worker.start();
      await scheduler.tickOnce();

      const runs = new PostgresRunRepository(database);
      await waitUntil(async () => {
        const listed = await runs.listRuns({
          workspaceId: WORKSPACE_ID,
          limit: 10,
        });
        return listed.runs.some((run) => run.status === "SUCCEEDED");
      });

      const listedRuns = await runs.listRuns({
        workspaceId: WORKSPACE_ID,
        limit: 10,
      });
      expect(listedRuns.runs).toHaveLength(1);
      const run = listedRuns.runs[0]!;
      const attempts = await runs.listRunAttempts(run.id);
      expect(attempts).toHaveLength(1);
      const attempt = attempts[0]!;

      const loadedAttempt = await fetchJson(
        `${origin}/v1/runs/${run.id}/attempts/${attempt.id}`,
      );
      expect(loadedAttempt.body).toMatchObject({
        status: "SUCCEEDED",
        output: {
          echoed: { prompt: "scheduled e2e" },
          ids: {
            runId: run.id,
            runAttemptId: attempt.id,
            workspaceId: WORKSPACE_ID,
            agentId: registered.agentId,
            agentVersionId: registered.agentVersionId,
          },
        },
      });

      const occurrences = await fetchJson(
        `${origin}/v1/schedules/${registered.scheduleId}/occurrences`,
      );
      expect(occurrences.body).toMatchObject({
        occurrences: [
          {
            scheduleId: registered.scheduleId,
            scheduledFor: tickAt.toISOString(),
            runId: run.id,
            dispatchedAt: tickAt.toISOString(),
          },
        ],
      });
      expect(await queue.countActiveJobs()).toBe(0);
    } finally {
      if (scheduler) {
        await scheduler.stop();
      }
      if (worker) {
        await worker.stop();
      }
      await queue.shutdown();
      await web.stop();
    }
  });

  it("recovers enqueue failures by reusing the same Run and RunAttempt", async () => {
    const trustedRuntimeRoot = await prepareEchoAgentFixture();
    const gatedQueue = new GatedBullMqJobQueue({ url: valkey.url });
    const runs = new PostgresRunRepository(database);
    const schedules = new PostgresScheduleRepository(database);
    const web = createWebProcess(
      {
        OSVA_DATABASE_URL: postgres.connectionString,
        OSVA_VALKEY_URL: valkey.url,
        OSVA_WEB_HOST: "127.0.0.1",
        OSVA_WEB_PORT: "0",
      },
      (connectionString) => createDatabase({ connectionString, max: 5 }),
      () => gatedQueue,
    );

    let worker: ReturnType<typeof createWorkerProcess> | undefined;
    let scheduler: ReturnType<typeof createSchedulerProcess> | undefined;

    try {
      const port = await web.listen();
      const origin = `http://127.0.0.1:${String(port)}`;
      const registered = await createEchoSchedule(origin, trustedRuntimeRoot);
      const tickAt = registered.nextRunAt;
      const clock = { now: () => tickAt };

      worker = createWorkerProcess(
        {
          OSVA_DATABASE_URL: postgres.connectionString,
          OSVA_VALKEY_URL: valkey.url,
          OSVA_TRUSTED_RUNTIME_ROOT: trustedRuntimeRoot,
        },
        (connectionString) => createDatabase({ connectionString, max: 5 }),
        { queueFactory: () => gatedQueue, clock },
      );
      scheduler = createSchedulerProcess(
        {
          OSVA_DATABASE_URL: postgres.connectionString,
          OSVA_VALKEY_URL: valkey.url,
        },
        (connectionString) => createDatabase({ connectionString, max: 5 }),
        {
          queueFactory: () => gatedQueue,
          clock,
        },
      );

      await worker.start();
      await scheduler.tickOnce();

      const listedRuns = await runs.listRuns({
        workspaceId: WORKSPACE_ID,
        limit: 10,
      });
      expect(listedRuns.runs).toHaveLength(1);
      const persistedRun = listedRuns.runs[0]!;
      expect(persistedRun.status).toBe("QUEUED");

      const occurrenceList = await schedules.listOccurrencesForSchedule({
        scheduleId: registered.scheduleId as ScheduleId,
        limit: 10,
      });
      expect(occurrenceList.occurrences).toHaveLength(1);
      expect(occurrenceList.occurrences[0]?.runId).toBe(persistedRun.id);
      expect(occurrenceList.occurrences[0]?.dispatchedAt).toBeNull();

      gatedQueue.enableEnqueue();
      await scheduler.tickOnce();

      await waitUntil(async () => {
        const run = await runs.findRunById(persistedRun.id);
        return run?.status === "SUCCEEDED";
      });

      const attempts = await runs.listRunAttempts(persistedRun.id);
      expect(attempts).toHaveLength(1);
      expect(attempts[0]?.status).toBe("SUCCEEDED");

      const redispatched = await schedules.listOccurrencesForSchedule({
        scheduleId: registered.scheduleId as ScheduleId,
        limit: 10,
      });
      expect(redispatched.occurrences[0]?.dispatchedAt?.toISOString()).toBe(
        tickAt.toISOString(),
      );
    } finally {
      if (scheduler) {
        await scheduler.stop();
      }
      if (worker) {
        await worker.stop();
      }
      await gatedQueue.shutdown();
      await web.stop();
    }
  });
});

async function prepareEchoAgentFixture(): Promise<string> {
  const trustedRuntimeRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "osva-scheduler-e2e-"),
  );
  await fs.copyFile(
    path.join(FIXTURE_DIR, "echo-agent.ts"),
    path.join(trustedRuntimeRoot, "echo-agent.ts"),
  );
  return trustedRuntimeRoot;
}

async function createEchoSchedule(
  origin: string,
  trustedRuntimeRoot: string,
): Promise<{
  readonly scheduleId: string;
  readonly agentId: string;
  readonly agentVersionId: string;
  readonly nextRunAt: Date;
}> {
  const integrity = sha256IntegrityOf(
    await fs.readFile(path.join(trustedRuntimeRoot, "echo-agent.ts")),
  );

  const agent = await fetchJson(`${origin}/v1/agents`, {
    method: "POST",
    body: {
      key: "echo-agent",
      name: "Echo Agent",
    },
  });
  const agentId = (agent.body as { id: string }).id;

  const version = await fetchJson(`${origin}/v1/agents/${agentId}/versions`, {
    method: "POST",
    body: {
      manifest: {
        schemaVersion: "1",
        key: "echo-agent",
        name: "Echo Agent",
        runtime: {
          type: "TRUSTED_TYPESCRIPT",
          entrypoint: "echo-agent.ts",
          integrity,
        },
        input: { schema: {} },
        output: { schema: {} },
        execution: { timeoutMs: 5_000, maxAttempts: 1 },
        capabilities: { model: false, tools: [] },
      },
    },
  });
  const agentVersionId = (version.body as { id: string }).id;

  const schedule = await fetchJson(`${origin}/v1/schedules`, {
    method: "POST",
    body: {
      key: "echo-every-minute",
      name: "Echo Every Minute",
      agentId,
      agentVersionId,
      cronExpression: "* * * * *",
      timezone: "UTC",
      input: { prompt: "scheduled e2e" },
    },
  });
  const scheduleBody = schedule.body as {
    id: string;
    nextRunAt: string;
  };

  return {
    scheduleId: scheduleBody.id,
    agentId,
    agentVersionId,
    nextRunAt: new Date(scheduleBody.nextRunAt),
  };
}

async function waitUntil(check: () => Promise<boolean>): Promise<void> {
  for (let attempt = 0; attempt < 300; attempt += 1) {
    if (await check()) {
      return;
    }
    await yieldToEventLoop();
  }
  throw new Error("Timed out waiting for scheduler execution.");
}

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => {
    setImmediate(resolve);
  });
}
