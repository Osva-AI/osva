import type {
  AgentId,
  AgentVersionId,
  ExecutionRequest,
  RunAttemptId,
  RunId,
  WorkspaceId,
} from "@osva/contracts";
import { FakeRuntimeAdapter } from "@osva/adapters-memory";
import {
  createDatabase,
  migrateDatabase,
  PostgresAgentRepository,
  PostgresRunRepository,
  PostgresWorkspaceRepository,
  type Database,
} from "@osva/db";
import {
  Agent,
  AgentVersion,
  Workspace,
  type AgentRepository,
  type WorkspaceRepository,
} from "@osva/domain";
import { CreateRun, ExecuteRunAttempt } from "@osva/orchestration";
import { Queue } from "bullmq";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { BullMqJobQueue } from "../../src/bullmq-job-queue.js";
import {
  EXECUTE_RUN_ATTEMPT_JOB_NAME,
  OSVA_EXECUTION_QUEUE_NAME,
} from "../../src/constants.js";
import { toBullMqJobId } from "../../src/job-id.js";
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
} from "./valkey-harness.js";

const NOW = new Date("2026-01-15T12:00:00.000Z");
const LATER = new Date("2026-01-15T12:00:01.000Z");
const workspaceId = "ws-1" as WorkspaceId;
const agentId = "agent-1" as AgentId;
const agentVersionId = "agent-version-1" as AgentVersionId;
const runId = "run-1" as RunId;
const runAttemptId = "run-attempt-1" as RunAttemptId;
const RUN_INPUT = { prompt: "hello from run" };

async function seedAgentGraph(
  workspaces: WorkspaceRepository,
  agents: AgentRepository,
): Promise<void> {
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
}

describe("ExecutionWorker BullMQ + PostgreSQL integration", () => {
  let postgres: PostgresTestContext;
  let valkey: ValkeyTestContext;
  let database: Database;
  let prefixCounter = 0;

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

  function nextPrefix(): string {
    prefixCounter += 1;
    return `osva-exec-${String(process.pid)}-${String(prefixCounter)}`;
  }

  it("reconstructs execution through ExecuteRunAttempt and keeps PostgreSQL authoritative", async () => {
    const prefix = nextPrefix();
    const workspaces = new PostgresWorkspaceRepository(database);
    const agents = new PostgresAgentRepository(database);
    const runs = new PostgresRunRepository(database);
    const queue = new BullMqJobQueue({ url: valkey.url, prefix });
    const received: ExecutionRequest[] = [];
    await seedAgentGraph(workspaces, agents);

    const createRun = new CreateRun({ runs, agents, queue });
    const executeRunAttempt = new ExecuteRunAttempt({
      runs,
      agents,
      runtime: new FakeRuntimeAdapter(async (request) => {
        received.push(request);
        return { status: "succeeded", output: { ok: true } };
      }),
    });

    await createRun.execute({
      runId,
      runAttemptId,
      workspaceId,
      agentId,
      agentVersionId,
      input: RUN_INPUT,
      now: NOW,
    });

    await queue.consume(async (payload) => {
      expect(Object.keys(payload)).toEqual(["runAttemptId"]);
      expect(payload.runAttemptId).toBe(runAttemptId);
      await executeRunAttempt.execute({
        runAttemptId: payload.runAttemptId,
        now: LATER,
      });
    });

    await waitUntil(async () => received.length === 1);

    expect((await runs.findRunById(runId))?.status).toBe("SUCCEEDED");
    expect((await runs.findRunAttemptById(runAttemptId))?.status).toBe(
      "SUCCEEDED",
    );
    expect(
      (await runs.listRunAttempts(runId)).map((attempt) => attempt.id),
    ).toEqual([runAttemptId]);
    await queue.shutdown();
  });

  it("treats terminal RunAttempt redelivery as an idempotent no-op", async () => {
    const prefix = nextPrefix();
    const workspaces = new PostgresWorkspaceRepository(database);
    const agents = new PostgresAgentRepository(database);
    const runs = new PostgresRunRepository(database);
    const queue = new BullMqJobQueue({ url: valkey.url, prefix });
    let executions = 0;
    await seedAgentGraph(workspaces, agents);

    const createRun = new CreateRun({ runs, agents, queue });
    const executeRunAttempt = new ExecuteRunAttempt({
      runs,
      agents,
      runtime: new FakeRuntimeAdapter(async () => {
        executions += 1;
        return { status: "succeeded", output: { ok: true } };
      }),
    });

    await createRun.execute({
      runId,
      runAttemptId,
      workspaceId,
      agentId,
      agentVersionId,
      input: RUN_INPUT,
      now: NOW,
    });

    await queue.consume(async ({ runAttemptId: delivered }) => {
      await executeRunAttempt.execute({
        runAttemptId: delivered,
        now: LATER,
      });
    });
    await waitUntil(async () => executions === 1);

    const raw = new Queue(OSVA_EXECUTION_QUEUE_NAME, {
      connection: { url: valkey.url, maxRetriesPerRequest: null },
      prefix,
    });
    try {
      await raw.add(
        EXECUTE_RUN_ATTEMPT_JOB_NAME,
        { runAttemptId },
        { jobId: "redeliver-terminal" },
      );
      await waitUntil(async () => {
        const attempt = await runs.findRunAttemptById(runAttemptId);
        return attempt?.status === "SUCCEEDED" && executions === 1;
      });
    } finally {
      await raw.close();
      await queue.shutdown();
    }

    expect(executions).toBe(1);
    expect(
      (await runs.listRunAttempts(runId)).map((attempt) => attempt.id),
    ).toEqual([runAttemptId]);
    expect((await runs.findRunById(runId))?.status).toBe("SUCCEEDED");
  });

  it("completes the BullMQ job when OSVA execution fails", async () => {
    const prefix = nextPrefix();
    const workspaces = new PostgresWorkspaceRepository(database);
    const agents = new PostgresAgentRepository(database);
    const runs = new PostgresRunRepository(database);
    const queue = new BullMqJobQueue({ url: valkey.url, prefix });
    await seedAgentGraph(workspaces, agents);

    const createRun = new CreateRun({ runs, agents, queue });
    const executeRunAttempt = new ExecuteRunAttempt({
      runs,
      agents,
      runtime: new FakeRuntimeAdapter(async () => ({
        status: "failed",
        error: { code: "AGENT_FAILED", message: "agent failed" },
      })),
    });

    await createRun.execute({
      runId,
      runAttemptId,
      workspaceId,
      agentId,
      agentVersionId,
      input: RUN_INPUT,
      now: NOW,
    });

    await queue.consume(async ({ runAttemptId: delivered }) => {
      const result = await executeRunAttempt.execute({
        runAttemptId: delivered,
        now: LATER,
      });
      expect(result.outcome).toBe("failed");
    });

    await waitUntil(async () => {
      const run = await runs.findRunById(runId);
      return run?.status === "FAILED";
    });

    const raw = new Queue(OSVA_EXECUTION_QUEUE_NAME, {
      connection: { url: valkey.url, maxRetriesPerRequest: null },
      prefix,
    });
    try {
      const job = await raw.getJob(toBullMqJobId(runAttemptId));
      expect(job).toBeDefined();
      await waitUntil(async () => (await job?.getState()) === "completed");
      expect(await job?.getState()).toBe("completed");
    } finally {
      await raw.close();
      await queue.shutdown();
    }

    expect((await runs.findRunById(runId))?.status).toBe("FAILED");
    expect((await runs.findRunAttemptById(runAttemptId))?.status).toBe(
      "FAILED",
    );
  });

  it("does not create a second RunAttempt when two workers share the queue", async () => {
    const prefix = nextPrefix();
    const workspaces = new PostgresWorkspaceRepository(database);
    const agents = new PostgresAgentRepository(database);
    const runs = new PostgresRunRepository(database);
    const producer = new BullMqJobQueue({ url: valkey.url, prefix });
    const first = new BullMqJobQueue({ url: valkey.url, prefix });
    const second = new BullMqJobQueue({ url: valkey.url, prefix });
    let executions = 0;
    await seedAgentGraph(workspaces, agents);

    const createRun = new CreateRun({ runs, agents, queue: producer });
    const executeRunAttempt = new ExecuteRunAttempt({
      runs,
      agents,
      runtime: new FakeRuntimeAdapter(async () => {
        executions += 1;
        await delay(50);
        return { status: "succeeded", output: { ok: true } };
      }),
    });

    const handler = async (payload: { runAttemptId: RunAttemptId }) => {
      await executeRunAttempt.execute({
        runAttemptId: payload.runAttemptId,
        now: LATER,
      });
    };

    await first.consume(handler);
    await second.consume(handler);

    await createRun.execute({
      runId,
      runAttemptId,
      workspaceId,
      agentId,
      agentVersionId,
      input: RUN_INPUT,
      now: NOW,
    });

    await waitUntil(async () => {
      const run = await runs.findRunById(runId);
      return run?.status === "SUCCEEDED";
    });

    await first.shutdown();
    await second.shutdown();
    await producer.shutdown();

    expect(executions).toBe(1);
    expect(
      (await runs.listRunAttempts(runId)).map((attempt) => attempt.id),
    ).toEqual([runAttemptId]);
  });
});

async function waitUntil(check: () => Promise<boolean>): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (await check()) {
      return;
    }
    await delay(50);
  }
  throw new Error("Timed out waiting for queue execution.");
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
