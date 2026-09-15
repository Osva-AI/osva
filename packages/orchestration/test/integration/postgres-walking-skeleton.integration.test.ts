import type { ExecutionRequest } from "@osva/contracts";
import { FakeRuntimeAdapter, MemoryJobQueue } from "@osva/adapters-memory";
import {
  createDatabase,
  migrateDatabase,
  PostgresAgentRepository,
  PostgresRunRepository,
  PostgresWorkspaceRepository,
  type Database,
} from "@osva/db";
import { Workspace, createAgentApplication } from "@osva/domain";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { CreateRun } from "../../src/create-run.js";
import { AgentNotFoundError } from "../../src/errors.js";
import { ExecuteRunAttempt } from "../../src/execute-run-attempt.js";
import {
  LATER,
  NOW,
  RUN_INPUT,
  agentId,
  agentVersionId,
  createBindings,
  createManifest,
  runAttemptId,
  runId,
  seedAgentGraph,
  workspaceId,
} from "../fixtures.js";
import {
  resetStage0Tables,
  startPostgresForTests,
  stopPostgresForTests,
  type PostgresTestContext,
} from "../../../db/test/integration/postgres-harness.js";

describe("PostgreSQL orchestration walking skeleton", () => {
  let context: PostgresTestContext;
  let database: Database;

  beforeAll(async () => {
    context = await startPostgresForTests();
    database = createDatabase({
      connectionString: context.connectionString,
      max: 5,
      connectTimeoutSeconds: 10,
    });
    await migrateDatabase(database);
  });

  afterAll(async () => {
    if (database) {
      await database.close();
    }
    if (context) {
      await stopPostgresForTests(context);
    }
  });

  beforeEach(async () => {
    await resetStage0Tables(database);
  });

  it("reconstructs ExecutionRequest from PostgreSQL state after a runAttemptId enqueue", async () => {
    const workspaces = new PostgresWorkspaceRepository(database);
    const agents = new PostgresAgentRepository(database);
    const runs = new PostgresRunRepository(database);
    const queue = new MemoryJobQueue();
    const received: ExecutionRequest[] = [];

    await seedAgentGraph(workspaces, agents, { timeoutMs: 12_345 });

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
      effectiveBindings: createBindings(),
      input: RUN_INPUT,
      now: NOW,
    });

    expect(queue.pendingRunAttemptIds()).toEqual([runAttemptId]);
    expect((await runs.findRunById(runId))?.status).toBe("QUEUED");
    expect((await runs.findRunAttemptById(runAttemptId))?.sequence).toBe(1);

    await queue.consume(async ({ runAttemptId: deliveredAttemptId }) => {
      expect(deliveredAttemptId).toBe(runAttemptId);
      const result = await executeRunAttempt.execute({
        runAttemptId: deliveredAttemptId,
        now: LATER,
      });
      expect(result.outcome).toBe("succeeded");
    });

    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({
      runId,
      runAttemptId,
      agentVersionId,
      input: RUN_INPUT,
      timeoutMs: 12_345,
      effectiveConfig: {},
      toolGrants: [],
      policyContext: {},
    });
    expect((await runs.findRunById(runId))?.status).toBe("SUCCEEDED");
    expect((await runs.findRunById(runId))?.input).toEqual(RUN_INPUT);
    expect((await runs.findRunAttemptById(runAttemptId))?.status).toBe(
      "SUCCEEDED",
    );
  });

  it("rejects a missing Agent before persisting or enqueueing", async () => {
    const agents = new PostgresAgentRepository(database);
    const runs = new PostgresRunRepository(database);
    const queue = new MemoryJobQueue();
    const createRun = new CreateRun({ runs, agents, queue });

    await expect(
      createRun.execute({
        runId,
        runAttemptId,
        workspaceId,
        agentId,
        effectiveBindings: createBindings(),
        input: RUN_INPUT,
        now: NOW,
      }),
    ).rejects.toBeInstanceOf(AgentNotFoundError);

    expect(await runs.findRunById(runId)).toBeNull();
    expect(await runs.findRunAttemptById(runAttemptId)).toBeNull();
    expect(queue.pendingRunAttemptIds()).toEqual([]);
  });

  it("accepts an AgentVersion created through the Agent Registry", async () => {
    const workspaces = new PostgresWorkspaceRepository(database);
    const agents = new PostgresAgentRepository(database);
    const runs = new PostgresRunRepository(database);
    const queue = new MemoryJobQueue();

    await workspaces.save(
      Workspace.create({
        id: workspaceId,
        name: "Workspace",
        createdAt: NOW,
      }),
    );

    let counter = 0;
    const registry = createAgentApplication({
      agents,
      workspaces,
      clock: { now: () => NOW },
      ids: {
        createId() {
          counter += 1;
          return counter === 1 ? agentId : agentVersionId;
        },
      },
    });

    await registry.createAgent.execute({
      workspaceId,
      key: "agent-key",
      name: "Example Agent",
    });
    await registry.appendAgentVersion.execute({
      agentId,
      manifest: createManifest(),
    });

    const createRun = new CreateRun({ runs, agents, queue });
    const result = await createRun.execute({
      runId,
      runAttemptId,
      workspaceId,
      agentId,
      effectiveBindings: createBindings(),
      input: RUN_INPUT,
      now: NOW,
    });

    expect(result.run.status).toBe("QUEUED");
    expect(result.run.effectiveBindings.agentVersionId).toBe(agentVersionId);
    expect(queue.pendingRunAttemptIds()).toEqual([runAttemptId]);
  });
});
