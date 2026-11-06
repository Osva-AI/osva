import {
  DECLARATIVE_CHECKPOINT_STATE_SCHEMA_VERSION,
  type CommitRunCheckpointCommand,
} from "@osva-ai/contracts";
import {
  Agent,
  AgentVersion,
  Run,
  RunAttempt,
  Workspace,
  assertCheckpointStateIntegrity,
} from "@osva/domain";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createDatabase, type Database } from "../../src/database.js";
import { migrateDatabase } from "../../src/migrate.js";
import { PostgresAgentRepository } from "../../src/repositories/postgres-agent-repository.js";
import { PostgresRunCheckpointRepository } from "../../src/repositories/postgres-run-checkpoint-repository.js";
import { PostgresRunRepository } from "../../src/repositories/postgres-run-repository.js";
import { PostgresWorkspaceRepository } from "../../src/repositories/postgres-workspace-repository.js";
import {
  LATER,
  NOW,
  RUN_INPUT,
  createBindings,
  createIds,
  createManifest,
} from "./fixtures.js";
import {
  resetStage0Tables,
  startPostgresForTests,
  stopPostgresForTests,
  type PostgresTestContext,
} from "./postgres-harness.js";

describe("PostgreSQL run checkpoints", () => {
  let context: PostgresTestContext;
  let database: Database;
  let workspaces: PostgresWorkspaceRepository;
  let agents: PostgresAgentRepository;
  let runs: PostgresRunRepository;
  let checkpoints: PostgresRunCheckpointRepository;

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
    checkpoints = new PostgresRunCheckpointRepository(database);
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

  it("commits monotonic checkpoints with idempotent writes and stale-generation rejection", async () => {
    const seeded = await seedQueuedPending("checkpoint");
    const runningAttempt = seeded.attempt
      .transitionTo("RUNNING", LATER)
      .withExecutionLease({
        owner: "worker-1",
        generation: 1,
        expiresAt: LATER,
      });
    const runningRun = seeded.run.transitionTo("RUNNING", LATER);
    await runs.transitionRunAndAttempt(
      seeded.run.status,
      runningRun,
      seeded.attempt.status,
      runningAttempt,
      { leaseTtlMs: 30_000 },
    );

    const baseCommand = (): CommitRunCheckpointCommand => ({
      workspaceId: seeded.run.workspaceId,
      runId: seeded.run.id,
      runAttemptId: seeded.attempt.id,
      executionGeneration: 1,
      executionOwner: "worker-1",
      runtimeKind: "DECLARATIVE",
      bindingIdentity: {
        agentVersionId: seeded.run.effectiveBindings.agentVersionId,
        modelProfileVersionBindings:
          seeded.run.effectiveBindings.modelProfileVersionBindings,
        toolVersionBindings: seeded.run.effectiveBindings.toolVersionBindings,
      },
      cursor: { phase: "after_model", checkpointSequence: 1 },
      state: {
        schemaVersion: DECLARATIVE_CHECKPOINT_STATE_SCHEMA_VERSION,
        messages: [{ role: "system", content: "test" }],
        modelInvocations: 1,
        toolInvocations: 0,
      },
      idempotencyKey: "idem-1",
    });

    const first = await checkpoints.commit(baseCommand());
    expect(first.outcome).toBe("committed");
    if (first.outcome !== "committed") {
      throw new Error("expected committed checkpoint");
    }
    expect(first.checkpoint.sequence).toBe(1);

    const duplicate = await checkpoints.commit(baseCommand());
    expect(duplicate.outcome).toBe("duplicate");
    if (duplicate.outcome !== "duplicate") {
      throw new Error("expected duplicate checkpoint");
    }
    expect(duplicate.checkpoint.id).toBe(first.checkpoint.id);

    const stale = await checkpoints.commit({
      ...baseCommand(),
      executionGeneration: 99,
      idempotencyKey: "idem-2",
    });
    expect(stale.outcome).toBe("stale_generation");

    const otherWorkspace = await checkpoints.findLatestByRun(
      "ws-other" as typeof seeded.run.workspaceId,
      seeded.run.id,
    );
    expect(otherWorkspace).toBeNull();
  });

  it("assigns monotonically increasing checkpoint sequences for one run", async () => {
    const seeded = await seedQueuedPending("sequence");
    const runningAttempt = seeded.attempt
      .transitionTo("RUNNING", LATER)
      .withExecutionLease({
        owner: "worker-1",
        generation: 1,
        expiresAt: LATER,
      });
    const runningRun = seeded.run.transitionTo("RUNNING", LATER);
    await runs.transitionRunAndAttempt(
      seeded.run.status,
      runningRun,
      seeded.attempt.status,
      runningAttempt,
      { leaseTtlMs: 30_000 },
    );

    for (let index = 1; index <= 3; index += 1) {
      const result = await checkpoints.commit({
        workspaceId: seeded.run.workspaceId,
        runId: seeded.run.id,
        runAttemptId: seeded.attempt.id,
        executionGeneration: 1,
        executionOwner: "worker-1",
        runtimeKind: "DECLARATIVE",
        bindingIdentity: {
          agentVersionId: seeded.run.effectiveBindings.agentVersionId,
          modelProfileVersionBindings:
            seeded.run.effectiveBindings.modelProfileVersionBindings,
          toolVersionBindings: seeded.run.effectiveBindings.toolVersionBindings,
        },
        cursor: { phase: "after_tool", checkpointSequence: index },
        state: {
          schemaVersion: DECLARATIVE_CHECKPOINT_STATE_SCHEMA_VERSION,
          messages: [{ role: "system", content: `step-${String(index)}` }],
          modelInvocations: index,
          toolInvocations: 0,
        },
        idempotencyKey: `seq-${String(index)}`,
      });
      expect(result.outcome).toBe("committed");
      if (result.outcome !== "committed") {
        throw new Error("expected committed checkpoint");
      }
      expect(result.checkpoint.sequence).toBe(index);
    }

    const latest = await checkpoints.findLatestByRun(
      seeded.run.workspaceId,
      seeded.run.id,
    );
    expect(latest?.sequence).toBe(3);
    expect(latest?.state.messages[0]?.content).toBe("step-3");
  });

  it("preserves checkpoint payload digest after PostgreSQL jsonb round trip", async () => {
    const seeded = await seedQueuedPending("digest");
    const runningAttempt = seeded.attempt
      .transitionTo("RUNNING", LATER)
      .withExecutionLease({
        owner: "worker-1",
        generation: 1,
        expiresAt: LATER,
      });
    await runs.transitionRunAndAttempt(
      seeded.run.status,
      seeded.run.transitionTo("RUNNING", LATER),
      seeded.attempt.status,
      runningAttempt,
      { leaseTtlMs: 30_000 },
    );

    const state = {
      schemaVersion: DECLARATIVE_CHECKPOINT_STATE_SCHEMA_VERSION,
      messages: [
        { role: "system" as const, content: "instructions" },
        {
          role: "user" as const,
          content: 'Untrusted run input (JSON):\n{"z":1,"a":2}',
        },
      ],
      modelInvocations: 0,
      toolInvocations: 0,
      pendingToolCalls: [
        {
          id: "call-1",
          name: "echo",
          arguments: { value: "x", nested: { b: 1, a: 2 } },
        },
      ],
    };

    const committed = await checkpoints.commit({
      workspaceId: seeded.run.workspaceId,
      runId: seeded.run.id,
      runAttemptId: seeded.attempt.id,
      executionGeneration: 1,
      executionOwner: "worker-1",
      runtimeKind: "DECLARATIVE",
      bindingIdentity: {
        agentVersionId: seeded.run.effectiveBindings.agentVersionId,
        modelProfileVersionBindings:
          seeded.run.effectiveBindings.modelProfileVersionBindings,
        toolVersionBindings: seeded.run.effectiveBindings.toolVersionBindings,
      },
      cursor: { phase: "after_prefetch", checkpointSequence: 1 },
      state,
      idempotencyKey: "digest-roundtrip",
    });
    expect(committed.outcome).toBe("committed");
    if (committed.outcome !== "committed") {
      throw new Error("expected committed checkpoint");
    }

    const loaded = await checkpoints.findLatestByRun(
      seeded.run.workspaceId,
      seeded.run.id,
    );
    expect(loaded).not.toBeNull();
    expect(
      assertCheckpointStateIntegrity(loaded!.state, loaded!.payloadDigest),
    ).toEqual(loaded!.state);
  });

  it("rejects invalid checkpoint state payloads", async () => {
    const seeded = await seedQueuedPending("invalid");
    const runningAttempt = seeded.attempt
      .transitionTo("RUNNING", LATER)
      .withExecutionLease({
        owner: "worker-1",
        generation: 1,
        expiresAt: LATER,
      });
    await runs.transitionRunAndAttempt(
      seeded.run.status,
      seeded.run.transitionTo("RUNNING", LATER),
      seeded.attempt.status,
      runningAttempt,
      { leaseTtlMs: 30_000 },
    );

    const result = await checkpoints.commit({
      workspaceId: seeded.run.workspaceId,
      runId: seeded.run.id,
      runAttemptId: seeded.attempt.id,
      executionGeneration: 1,
      executionOwner: "worker-1",
      runtimeKind: "DECLARATIVE",
      bindingIdentity: {
        agentVersionId: seeded.run.effectiveBindings.agentVersionId,
        modelProfileVersionBindings:
          seeded.run.effectiveBindings.modelProfileVersionBindings,
        toolVersionBindings: seeded.run.effectiveBindings.toolVersionBindings,
      },
      cursor: { phase: "after_model", checkpointSequence: 1 },
      state: {
        schemaVersion: "99",
        messages: [],
        modelInvocations: 0,
        toolInvocations: 0,
      } as unknown as CommitRunCheckpointCommand["state"],
      idempotencyKey: "bad-state",
    });
    expect(result.outcome).toBe("invalid_state");
  });

  async function seedQueuedPending(suffix: string) {
    const ids = createIds(suffix);
    await workspaces.save(
      Workspace.create({
        id: ids.workspaceId,
        name: `ws-${suffix}`,
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
    const bindings = createBindings(
      ids.agentVersionId,
      ids.modelProfileVersionId,
    );
    const attempt = RunAttempt.createFirst({
      id: ids.runAttemptId,
      runId: ids.runId,
      createdAt: NOW,
    });
    await runs.createRunWithInitialAttempt(
      Run.create({
        id: ids.runId,
        workspaceId: ids.workspaceId,
        agentId: ids.agentId,
        effectiveBindings: bindings,
        input: RUN_INPUT,
        createdAt: NOW,
      }),
      attempt,
    );
    const queuedRun = Run.create({
      id: ids.runId,
      workspaceId: ids.workspaceId,
      agentId: ids.agentId,
      effectiveBindings: bindings,
      input: RUN_INPUT,
      createdAt: NOW,
    }).transitionTo("QUEUED", LATER);
    await runs.transitionRun("PENDING", queuedRun);

    return {
      run: (await runs.findRunById(ids.runId))!,
      attempt: (await runs.findRunAttemptById(ids.runAttemptId))!,
      ids,
    };
  }
});
