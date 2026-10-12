import { EXECUTION_INTERRUPTED_ERROR_CODE } from "@osva-ai/contracts";
import {
  FakeRuntimeAdapter,
  MemoryAgentRepository,
  MemoryJobQueue,
  MemoryRunRepository,
  MemoryWorkspaceRepository,
} from "@osva/adapters-memory";
import { describe, expect, it } from "vitest";

import { CreateRun } from "../src/create-run.js";
import { ExecuteRunAttempt } from "../src/execute-run-attempt.js";
import { ExecutionRecoveryTick } from "../src/execution-recovery-tick.js";
import {
  LATER,
  NOW,
  RUN_INPUT,
  agentId,
  agentVersionId,
  runAttemptId,
  runId,
  seedAgentGraph,
  workspaceId,
} from "./fixtures.js";

const EXPIRED = new Date(LATER.getTime() + 60_000);

describe("ExecutionRecoveryTick", () => {
  it("fails expired leased RUNNING attempts in place and skips unleased legacy rows", async () => {
    const { runs, tick } = await harness();
    const pending = await runs.findRunAttemptById(runAttemptId);
    const queued = await runs.findRunById(runId);
    if (pending === null || queued === null) {
      throw new Error("expected persisted run");
    }

    const leased = pending.transitionTo("RUNNING", LATER).withExecutionLease({
      owner: "worker-dead",
      generation: 1,
      expiresAt: LATER,
    });
    await runs.transitionRunAndAttempt(
      queued.status,
      queued.transitionTo("RUNNING", LATER),
      pending.status,
      leased,
    );

    runs.clock = { now: () => EXPIRED };
    await tick.execute();

    const failed = await runs.findRunAttemptById(runAttemptId);
    expect(failed?.status).toBe("FAILED");
    expect(failed?.error?.code).toBe(EXECUTION_INTERRUPTED_ERROR_CODE);
    expect((await runs.findRunById(runId))?.status).toBe("FAILED");
  });

  it("does not fail a RUNNING attempt whose heartbeat still owns the lease", async () => {
    const { runs, tick } = await harness();
    const pending = await runs.findRunAttemptById(runAttemptId);
    const queued = await runs.findRunById(runId);
    if (pending === null || queued === null) {
      throw new Error("expected persisted run");
    }

    await runs.transitionRunAndAttempt(
      queued.status,
      queued.transitionTo("RUNNING", LATER),
      pending.status,
      pending.transitionTo("RUNNING", LATER).withExecutionLease({
        owner: "worker-live",
        generation: 1,
        expiresAt: EXPIRED,
      }),
    );

    runs.clock = { now: () => LATER };
    await tick.execute();

    expect((await runs.findRunAttemptById(runAttemptId))?.status).toBe(
      "RUNNING",
    );
  });

  it("repairs QUEUED/PENDING deliveries onto the same RunAttempt id", async () => {
    const { runs, queue, tick } = await harness();
    expect(queue.pendingRunAttemptIds()).toEqual([runAttemptId]);
    await queue.cancel(runAttemptId);
    expect(queue.pendingRunAttemptIds()).toEqual([]);

    await tick.execute();

    expect(queue.pendingRunAttemptIds()).toEqual([runAttemptId]);
    expect((await runs.findRunAttemptById(runAttemptId))?.status).toBe(
      "PENDING",
    );
    await tick.execute();
    expect(queue.pendingRunAttemptIds()).toEqual([runAttemptId]);
  });
});

async function harness() {
  const workspaces = new MemoryWorkspaceRepository();
  const agents = new MemoryAgentRepository();
  const runs = new MemoryRunRepository();
  runs.clock = { now: () => LATER };
  const queue = new MemoryJobQueue();
  await seedAgentGraph(workspaces, agents);
  await new CreateRun({ runs, agents, queue }).execute({
    runId,
    runAttemptId,
    workspaceId,
    agentId,
    agentVersionId,
    input: RUN_INPUT,
    now: NOW,
  });
  const tick = new ExecutionRecoveryTick({
    runs,
    queue,
    clock: { now: () => runs.clock.now() },
  });
  return {
    agents,
    runs,
    queue,
    tick,
    execute: new ExecuteRunAttempt({
      runs,
      agents,
      runtime: new FakeRuntimeAdapter(async () => ({
        status: "succeeded",
        output: { ok: true },
      })),
    }),
  };
}
