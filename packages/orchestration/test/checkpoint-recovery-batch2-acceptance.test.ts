import {
  DECLARATIVE_CHECKPOINT_STATE_SCHEMA_VERSION,
  DEFAULT_MAX_RECOVERY_ATTEMPTS,
  EXECUTION_INTERRUPTED_ERROR_CODE,
  RECOVERY_BLOCKED_UNCERTAIN_OPERATION_CODE,
  type RunAttemptId,
} from "@osva-ai/contracts";
import {
  MemoryAgentRepository,
  MemoryJobQueue,
  MemoryRunCheckpointRepository,
  MemoryRunOperationJournalRepository,
  MemoryRunRepository,
  MemoryWorkspaceRepository,
} from "@osva/adapters-memory";
import { Agent, AgentVersion, Workspace } from "@osva/domain";
import { describe, expect, it } from "vitest";

import { CreateRun } from "../src/create-run.js";
import { ExecutionRecoveryTick } from "../src/execution-recovery-tick.js";
import { RecoverInterruptedRun } from "../src/recover-interrupted-run.js";
import {
  agentId,
  agentVersionId,
  createManifest,
  LATER,
  modelProfileVersionId,
  NOW,
  RUN_INPUT,
  runAttemptId,
  runId,
  workspaceId,
} from "./fixtures.js";

const EXPIRED = new Date(LATER.getTime() + 60_000);

async function seedCheckpointAgent(options?: {
  readonly checkpointingEnabled?: boolean;
  readonly automaticRecoveryEnabled?: boolean;
}) {
  const workspaces = new MemoryWorkspaceRepository();
  const agents = new MemoryAgentRepository();
  const runs = new MemoryRunRepository();
  const checkpoints = new MemoryRunCheckpointRepository();
  const operationJournal = new MemoryRunOperationJournalRepository();
  const queue = new MemoryJobQueue();
  runs.clock = { now: () => LATER };

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
      key: "agent-key-1",
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
        ...createManifest({
          capabilities: { model: true, tools: [] },
          models: {
            default: { modelProfileVersionId },
          },
        }),
        runtime: {
          type: "DECLARATIVE",
          config: {
            configVersion: "1",
            instructions: "test",
            modelBinding: "default",
            allowedToolBindings: [],
            maxModelInvocations: 4,
            maxToolInvocations: 4,
            checkpointingEnabled: options?.checkpointingEnabled ?? true,
            automaticRecoveryEnabled: options?.automaticRecoveryEnabled ?? true,
          },
        },
      },
      createdAt: NOW,
    }),
  );

  return { workspaces, agents, runs, checkpoints, operationJournal, queue };
}

function recoveryTick(deps: {
  runs: MemoryRunRepository;
  queue: MemoryJobQueue;
  checkpoints: MemoryRunCheckpointRepository;
  operationJournal: MemoryRunOperationJournalRepository;
  agents: MemoryAgentRepository;
}) {
  let attemptSeq = 1;
  return new ExecutionRecoveryTick({
    runs: deps.runs,
    queue: deps.queue,
    checkpoints: deps.checkpoints,
    operationJournal: deps.operationJournal,
    agents: deps.agents,
    createRunAttemptId: () =>
      `recovery-attempt-${String((attemptSeq += 1))}` as RunAttemptId,
    clock: { now: () => deps.runs.clock.now() },
  });
}

describe("Batch 2 checkpoint recovery acceptance", () => {
  it("1 legacy: crash before checkpoint fails run in place", async () => {
    const deps = await seedCheckpointAgent({ checkpointingEnabled: false });
    await new CreateRun({
      runs: deps.runs,
      agents: deps.agents,
      queue: deps.queue,
    }).execute({
      runId,
      runAttemptId,
      workspaceId,
      agentId,
      agentVersionId,
      input: RUN_INPUT,
      now: NOW,
    });

    const pending = await deps.runs.findRunAttemptById(runAttemptId);
    const run = await deps.runs.findRunById(runId);
    if (pending === null || run === null) {
      throw new Error("missing run");
    }
    await deps.runs.transitionRunAndAttempt(
      run.status,
      run.transitionTo("RUNNING", LATER),
      pending.status,
      pending.transitionTo("RUNNING", LATER).withExecutionLease({
        owner: "worker-dead",
        generation: 1,
        expiresAt: LATER,
      }),
    );

    deps.runs.clock = { now: () => EXPIRED };
    await recoveryTick(deps).execute();

    expect((await deps.runs.findRunById(runId))?.status).toBe("FAILED");
    expect((await deps.checkpoints.countByRun(runId)) === 0).toBe(true);
  });

  it("2 crash after checkpoint interrupts and auto-schedules successor", async () => {
    const deps = await seedCheckpointAgent();
    await seedQueuedRun(deps);
    await commitMinimalCheckpoint(deps);

    await expireLease(deps.runs);
    deps.runs.clock = { now: () => EXPIRED };
    await recoveryTick(deps).execute();

    expect((await deps.runs.findRunById(runId))?.status).toBe("QUEUED");
    const attempts = await deps.runs.listRunAttempts(runId);
    expect(attempts.length).toBe(2);
    const successor = attempts.find(
      (row) => row.id !== runAttemptId && row.status === "PENDING",
    );
    expect(successor).toBeDefined();
    expect(deps.queue.pendingRunAttemptIds()).toContain(successor?.id);
  });

  it("5 unknown non-idempotent pending operation blocks automatic recovery", async () => {
    const deps = await seedCheckpointAgent();
    await seedQueuedRun(deps);
    await commitMinimalCheckpoint(deps);
    await deps.operationJournal.recordPending({
      workspaceId,
      runId,
      runAttemptId,
      executionGeneration: 1,
      operationKey: `${runId}:tool-call-1`,
      toolVersionId: "tool-v1" as import("@osva-ai/contracts").ToolVersionId,
      bindingName: "write",
      inputFingerprint: "abc",
      idempotencyClass: "UNKNOWN_WRITE",
    });

    await expireLease(deps.runs);
    deps.runs.clock = { now: () => EXPIRED };
    await recoveryTick(deps).execute();

    expect((await deps.runs.findRunById(runId))?.status).toBe("INTERRUPTED");
    expect((await deps.runs.listRunAttempts(runId)).length).toBe(1);
  });

  it("8 concurrent recovery tickers schedule at most one successor", async () => {
    const deps = await seedCheckpointAgent();
    await seedQueuedRun(deps);
    await commitMinimalCheckpoint(deps);
    await expireLease(deps.runs);
    deps.runs.clock = { now: () => EXPIRED };

    const tick = recoveryTick(deps);
    await Promise.all([tick.execute(), tick.execute(), tick.execute()]);

    const attempts = await deps.runs.listRunAttempts(runId);
    expect(attempts.filter((row) => row.status === "PENDING").length).toBe(1);
  });

  it("10 recovery limit exhaustion prevents further scheduling", async () => {
    const deps = await seedCheckpointAgent();
    await seedQueuedRun(deps);
    await commitMinimalCheckpoint(deps);
    await expireLease(deps.runs, {
      recoveryAttemptCount: DEFAULT_MAX_RECOVERY_ATTEMPTS,
    });

    deps.runs.clock = { now: () => EXPIRED };
    await recoveryTick(deps).execute();
    expect((await deps.runs.listRunAttempts(runId)).length).toBe(1);
  });

  it("11 manual and automatic recovery share eligibility checks", async () => {
    const deps = await seedCheckpointAgent();
    await seedQueuedRun(deps);
    await commitMinimalCheckpoint(deps);
    await deps.operationJournal.recordPending({
      workspaceId,
      runId,
      runAttemptId,
      executionGeneration: 1,
      operationKey: `${runId}:tool-call-2`,
      toolVersionId: "tool-v1" as import("@osva-ai/contracts").ToolVersionId,
      bindingName: "write",
      inputFingerprint: "abc",
      idempotencyClass: "UNKNOWN_WRITE",
    });
    await expireLease(deps.runs);
    deps.runs.clock = { now: () => EXPIRED };
    await recoveryTick(deps).execute();

    const recover = new RecoverInterruptedRun({
      runs: deps.runs,
      checkpoints: deps.checkpoints,
      operationJournal: deps.operationJournal,
      queue: deps.queue,
    });
    const manual = await recover.execute({
      workspaceId,
      runId,
      now: EXPIRED,
      newRunAttemptId: "manual-attempt" as RunAttemptId,
      automatic: false,
    });
    expect(manual.outcome).toBe("ineligible");
    if (manual.outcome === "ineligible") {
      expect(manual.code).toBe(RECOVERY_BLOCKED_UNCERTAIN_OPERATION_CODE);
    }
  });

  it("12 automatic recovery wiring absent without operation journal", async () => {
    const deps = await seedCheckpointAgent();
    await seedQueuedRun(deps);
    await commitMinimalCheckpoint(deps);
    await expireLease(deps.runs);
    deps.runs.clock = { now: () => EXPIRED };

    const tick = new ExecutionRecoveryTick({
      runs: deps.runs,
      queue: deps.queue,
      checkpoints: deps.checkpoints,
      agents: deps.agents,
      createRunAttemptId: () => "x" as RunAttemptId,
      clock: { now: () => EXPIRED },
    });
    await tick.execute();
    expect((await deps.runs.findRunById(runId))?.status).toBe("INTERRUPTED");
    expect((await deps.runs.listRunAttempts(runId)).length).toBe(1);
  });
});

async function seedQueuedRun(deps: {
  runs: MemoryRunRepository;
  agents: MemoryAgentRepository;
  queue: MemoryJobQueue;
}) {
  await new CreateRun({
    runs: deps.runs,
    agents: deps.agents,
    queue: deps.queue,
  }).execute({
    runId,
    runAttemptId,
    workspaceId,
    agentId,
    agentVersionId,
    input: RUN_INPUT,
    now: NOW,
  });
}

async function commitMinimalCheckpoint(deps: {
  checkpoints: MemoryRunCheckpointRepository;
  runs: MemoryRunRepository;
}) {
  const pending = await deps.runs.findRunAttemptById(runAttemptId);
  const run = await deps.runs.findRunById(runId);
  if (pending === null || run === null) {
    throw new Error("missing run");
  }
  await deps.runs.transitionRunAndAttempt(
    run.status,
    run.transitionTo("RUNNING", LATER),
    pending.status,
    pending.transitionTo("RUNNING", LATER).withExecutionLease({
      owner: "worker-1",
      generation: 1,
      expiresAt: LATER,
    }),
  );
  deps.checkpoints.trackRunningAttempt({
    runAttemptId,
    owner: "worker-1",
    generation: 1,
  });
  const result = await deps.checkpoints.commit({
    workspaceId,
    runId,
    runAttemptId,
    runtimeKind: "DECLARATIVE",
    bindingIdentity: {
      agentVersionId,
      modelProfileVersionBindings: { default: modelProfileVersionId },
      toolVersionBindings: {},
    },
    executionGeneration: 1,
    executionOwner: "worker-1",
    cursor: { phase: "after_prefetch", checkpointSequence: 1 },
    state: {
      schemaVersion: DECLARATIVE_CHECKPOINT_STATE_SCHEMA_VERSION,
      messages: [{ role: "system", content: "x" }],
      modelInvocations: 0,
      toolInvocations: 0,
    },
    idempotencyKey: "prefetch-1",
  });
  if (result.outcome !== "committed") {
    throw new Error(`checkpoint commit failed: ${result.outcome}`);
  }
}

async function expireLease(
  runs: MemoryRunRepository,
  recovery?: { readonly recoveryAttemptCount: number },
) {
  const pending = await runs.findRunAttemptById(runAttemptId);
  if (pending === null) {
    throw new Error("missing attempt");
  }
  await runs.interruptExpiredLeasedAttemptForRecovery({
    runAttemptId,
    generation: 1,
    now: EXPIRED,
    error: {
      code: EXECUTION_INTERRUPTED_ERROR_CODE,
      message: "lease expired",
    },
    recoveryMetadata: {
      version: "1",
      recoveryAttemptCount: recovery?.recoveryAttemptCount ?? 0,
      automaticRecoveryEnabled: true,
    },
  });
}
