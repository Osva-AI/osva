import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type {
  AgentId,
  AgentVersionId,
  RunAttemptId,
  RunId,
  WorkspaceId,
} from "@osva/contracts";
import { FakeRuntimeAdapter } from "@osva/adapters-memory";
import { BullMqJobQueue } from "@osva/adapters-bullmq";
import {
  createDatabase,
  migrateDatabase,
  PostgresAgentRepository,
  PostgresRunRepository,
  PostgresWorkspaceRepository,
  type Database,
} from "@osva/db";
import { Agent, AgentVersion, Workspace } from "@osva/domain";
import { CreateRun } from "@osva/orchestration";

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

const NOW = new Date("2026-01-15T12:00:00.000Z");
const workspaceId = "ws-1" as WorkspaceId;
const agentId = "agent-1" as AgentId;
const agentVersionId = "agent-version-1" as AgentVersionId;
const runId = "run-1" as RunId;
const runAttemptId = "run-attempt-1" as RunAttemptId;

describe("worker process BullMQ integration", () => {
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
  });

  it("consumes through ExecuteRunAttempt when a test runtime is injected", async () => {
    const workspaces = new PostgresWorkspaceRepository(database);
    const agents = new PostgresAgentRepository(database);
    const runs = new PostgresRunRepository(database);
    const producer = new BullMqJobQueue({ url: valkey.url });
    let executions = 0;

    await workspaces.save(
      Workspace.create({
        id: workspaceId,
        name: "Workspace",
        createdAt: NOW,
      }),
    );
    await agents.saveAgent(
      Agent.create({
        id: agentId,
        workspaceId,
        key: "example-agent",
        name: "Example Agent",
        createdAt: NOW,
      }),
    );
    await agents.saveAgentVersion(
      AgentVersion.create({
        id: agentVersionId,
        agentId,
        version: 1,
        manifest: {
          schemaVersion: "1",
          key: "example-agent",
          name: "Example Agent",
          runtime: { type: "BUILTIN_PACKAGE", key: "example-agent" },
          input: { schema: {} },
          output: { schema: {} },
          execution: { timeoutMs: 30_000, maxAttempts: 2 },
          capabilities: { model: false, tools: [] },
        },
        createdAt: NOW,
      }),
    );

    const worker = createWorkerProcess(
      {
        OSVA_DATABASE_URL: postgres.connectionString,
        OSVA_VALKEY_URL: valkey.url,
      },
      (connectionString) =>
        createDatabase({
          connectionString,
          max: 5,
        }),
      {
        runtime: new FakeRuntimeAdapter(async () => {
          executions += 1;
          return { status: "succeeded", output: { ok: true } };
        }),
      },
    );

    try {
      await worker.start();
      const createRun = new CreateRun({ runs, agents, queue: producer });
      await createRun.execute({
        runId,
        runAttemptId,
        workspaceId,
        agentId,
        agentVersionId,
        input: { prompt: "go" },
        now: NOW,
      });

      const deadline = Date.now() + 10_000;
      while (Date.now() < deadline) {
        const run = await runs.findRunById(runId);
        if (run?.status === "SUCCEEDED") {
          break;
        }
        await delay(50);
      }

      expect(executions).toBe(1);
      expect((await runs.findRunById(runId))?.status).toBe("SUCCEEDED");
      expect((await runs.findRunAttemptById(runAttemptId))?.status).toBe(
        "SUCCEEDED",
      );
    } finally {
      await worker.stop();
      await producer.shutdown();
    }
  });

  it("shuts down without hanging after connecting to Valkey", async () => {
    const worker = createWorkerProcess(
      {
        OSVA_DATABASE_URL: postgres.connectionString,
        OSVA_VALKEY_URL: valkey.url,
      },
      () =>
        createDatabase({
          connectionString: postgres.connectionString,
          max: 2,
        }),
    );

    await worker.start();
    const shutdown = worker.stop();
    await expect(
      Promise.race([
        shutdown.then(() => "closed"),
        delay(5_000).then(() => "timeout"),
      ]),
    ).resolves.toBe("closed");
  });
});

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
