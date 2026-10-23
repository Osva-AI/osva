import type { RunAttemptId, RunId, RunStepId } from "@osva-ai/contracts";
import {
  Agent,
  AgentVersion,
  Run,
  RunAttempt,
  RunStep,
  Workspace,
} from "@osva/domain";
import type { RunRepository } from "@osva/domain";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createDatabase, type Database } from "../../src/database.js";
import { migrateDatabase } from "../../src/migrate.js";
import { PostgresAgentRepository } from "../../src/repositories/postgres-agent-repository.js";
import { PostgresRunRepository } from "../../src/repositories/postgres-run-repository.js";
import { PostgresWorkspaceRepository } from "../../src/repositories/postgres-workspace-repository.js";
import {
  EVEN_LATER,
  LATER,
  NOW,
  createBindings,
  createIds,
  createManifest,
  RUN_INPUT,
} from "./fixtures.js";
import {
  resetStage0Tables,
  startPostgresForTests,
  stopPostgresForTests,
  type PostgresTestContext,
} from "./postgres-harness.js";

describe("aggregateRunAttemptUsageBatch", () => {
  let context: PostgresTestContext;
  let database: Database;
  let runs: RunRepository;
  let workspaces: PostgresWorkspaceRepository;
  let agents: PostgresAgentRepository;

  beforeAll(async () => {
    context = await startPostgresForTests();
    database = createDatabase({
      connectionString: context.connectionString,
      max: 5,
      connectTimeoutSeconds: 10,
    });
    await migrateDatabase(database);
    workspaces = new PostgresWorkspaceRepository(database);
    agents = new PostgresAgentRepository(database);
    runs = new PostgresRunRepository(database);
  });

  afterAll(async () => {
    await database.close();
    await stopPostgresForTests(context);
  });

  beforeEach(async () => {
    await resetStage0Tables(database);
  });

  async function seedAgentGraph(label: string) {
    const ids = createIds(label);
    await workspaces.save(
      Workspace.create({
        id: ids.workspaceId,
        name: "Workspace",
        createdAt: NOW,
      }),
    );
    await agents.saveAgent(
      Agent.create({
        id: ids.agentId,
        workspaceId: ids.workspaceId,
        key: `agent-key-${ids.agentId}`,
        name: "Example Agent",
        createdAt: NOW,
      }),
    );
    await agents.saveAgentVersion(
      AgentVersion.create({
        id: ids.agentVersionId,
        agentId: ids.agentId,
        version: 1,
        manifest: createManifest(),
        createdAt: NOW,
      }),
    );
    return ids;
  }

  async function seedRun(label: string) {
    const ids = await seedAgentGraph(label);
    await runs.saveRun(
      Run.create({
        id: ids.runId,
        workspaceId: ids.workspaceId,
        agentId: ids.agentId,
        effectiveBindings: createBindings(
          ids.agentVersionId,
          ids.modelProfileVersionId,
        ),
        input: RUN_INPUT,
        createdAt: NOW,
      }),
    );
    await runs.saveRunAttempt(
      RunAttempt.createFirst({
        id: ids.runAttemptId,
        runId: ids.runId,
        createdAt: NOW,
      }),
    );
    return ids;
  }

  async function insertModelStep(options: {
    readonly id: RunStepId;
    readonly runId: RunId;
    readonly runAttemptId: RunAttemptId;
    readonly modelProfileVersionId: import("@osva-ai/contracts").ModelProfileVersionId;
    readonly finalize: Parameters<RunRepository["finalizeRunStep"]>[1];
  }): Promise<void> {
    await runs.insertRunningRunStep(
      RunStep.start({
        id: options.id,
        runId: options.runId,
        runAttemptId: options.runAttemptId,
        kind: "MODEL",
        bindingName: "default",
        startedAt: NOW,
        modelProfileVersionId: options.modelProfileVersionId,
      }),
    );
    await runs.finalizeRunStep(options.id, options.finalize);
  }

  it("returns zeros for empty batch input", async () => {
    const summary = await runs.aggregateRunAttemptUsageBatch([]);
    expect(summary).toMatchObject({
      modelCalls: 0,
      inputTokens: 0,
      outputTokens: 0,
      pricedModelCalls: 0,
      unpricedModelCalls: 0,
      estimatedCostUsdMicros: null,
    });
  });

  it("aggregates usage across multiple child runs and retry attempts", async () => {
    const first = await seedRun("usage_a");
    const second = await seedRun("usage_b");

    await insertModelStep({
      id: "step_a1" as RunStepId,
      runId: first.runId,
      runAttemptId: first.runAttemptId,
      modelProfileVersionId: first.modelProfileVersionId,
      finalize: {
        status: "SUCCEEDED",
        completedAt: LATER,
        inputTokens: 10,
        outputTokens: 5,
        totalTokens: 15,
        estimatedCostUsdMicros: 100,
      },
    });

    const attemptOne = await runs.findRunAttemptById(first.runAttemptId);
    if (attemptOne === null) {
      throw new Error("Expected first RunAttempt to exist.");
    }
    const runningAttemptOne = await runs.transitionRunAttempt(
      "PENDING",
      attemptOne.transitionTo("RUNNING", LATER),
    );
    const failedAttemptOne = await runs.transitionRunAttempt(
      "RUNNING",
      runningAttemptOne.transitionTo("FAILED", LATER),
    );
    const retryAttempt = RunAttempt.createSubsequent(failedAttemptOne, {
      id: first.secondAttemptId,
      createdAt: LATER,
    });
    await runs.saveRunAttempt(retryAttempt);

    await insertModelStep({
      id: "step_a_retry" as RunStepId,
      runId: first.runId,
      runAttemptId: first.secondAttemptId,
      modelProfileVersionId: first.modelProfileVersionId,
      finalize: {
        status: "SUCCEEDED",
        completedAt: EVEN_LATER,
        inputTokens: 3,
        outputTokens: 2,
        totalTokens: 5,
        estimatedCostUsdMicros: 40,
      },
    });

    await insertModelStep({
      id: "step_b_unpriced" as RunStepId,
      runId: second.runId,
      runAttemptId: second.runAttemptId,
      modelProfileVersionId: second.modelProfileVersionId,
      finalize: {
        status: "SUCCEEDED",
        completedAt: LATER,
        inputTokens: 7,
        outputTokens: 1,
        totalTokens: 8,
      },
    });

    const attemptIds = [
      first.runAttemptId,
      first.secondAttemptId,
      second.runAttemptId,
    ];
    const batch = await runs.aggregateRunAttemptUsageBatch(attemptIds);

    expect(batch).toMatchObject({
      inputTokens: 20,
      outputTokens: 8,
      pricedModelCalls: 2,
      unpricedModelCalls: 1,
    });
    expect(batch.estimatedCostUsdMicros).toBe(140);

    const single = await runs.aggregateRunAttemptUsage(first.runAttemptId);
    expect(single.inputTokens).toBe(10);
    expect(single.outputTokens).toBe(5);

    const repeat = await runs.aggregateRunAttemptUsageBatch(attemptIds);
    expect(repeat).toEqual(batch);
  });

  it("includes measurable usage on failed model steps when tokens were recorded", async () => {
    const ids = await seedRun("usage_failed_step");
    await insertModelStep({
      id: "step_failed_usage" as RunStepId,
      runId: ids.runId,
      runAttemptId: ids.runAttemptId,
      modelProfileVersionId: ids.modelProfileVersionId,
      finalize: {
        status: "FAILED",
        completedAt: LATER,
        inputTokens: 4,
        outputTokens: 0,
        totalTokens: 4,
        errorCode: "MODEL_ERROR",
      },
    });

    const summary = await runs.aggregateRunAttemptUsage(ids.runAttemptId);
    expect(summary).toMatchObject({
      modelCalls: 1,
      inputTokens: 4,
      outputTokens: 0,
      unpricedModelCalls: 1,
      estimatedCostUsdMicros: null,
    });
  });

  it("ignores failed model steps without recorded usage", async () => {
    const ids = await seedRun("usage_failed_empty");
    await insertModelStep({
      id: "step_failed_empty" as RunStepId,
      runId: ids.runId,
      runAttemptId: ids.runAttemptId,
      modelProfileVersionId: ids.modelProfileVersionId,
      finalize: {
        status: "FAILED",
        completedAt: LATER,
        errorCode: "MODEL_ERROR",
      },
    });

    const summary = await runs.aggregateRunAttemptUsage(ids.runAttemptId);
    expect(summary).toMatchObject({
      modelCalls: 0,
      inputTokens: 0,
      outputTokens: 0,
    });
  });
});
