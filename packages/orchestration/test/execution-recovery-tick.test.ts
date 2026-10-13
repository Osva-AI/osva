import { EXECUTION_INTERRUPTED_ERROR_CODE } from "@osva-ai/contracts";
import {
  FakeRuntimeAdapter,
  MemoryAgentRepository,
  MemoryJobQueue,
  MemoryRunRepository,
  MemoryWorkspaceRepository,
} from "@osva/adapters-memory";
import { OSVA_METRIC, RecordingInstrumentation } from "@osva/observability";
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

  it("does not count an already-present enqueue as a transport repair", async () => {
    const telemetry = new RecordingInstrumentation();
    const { queue, tick } = await harness(telemetry);
    expect(queue.pendingRunAttemptIds()).toEqual([runAttemptId]);

    await tick.execute();
    expect(
      telemetry.countersNamed(OSVA_METRIC.RECOVERY_TRANSPORT_REPAIRED),
    ).toHaveLength(0);

    await queue.cancel(runAttemptId);
    await tick.execute();
    expect(
      telemetry.countersNamed(OSVA_METRIC.RECOVERY_TRANSPORT_REPAIRED),
    ).toHaveLength(1);

    await tick.execute();
    expect(
      telemetry.countersNamed(OSVA_METRIC.RECOVERY_TRANSPORT_REPAIRED),
    ).toHaveLength(1);
  });

  it("counts only CAS-won lease interruptions and enqueue successes", async () => {
    const telemetry = new RecordingInstrumentation();
    const { runs, tick } = await harness(telemetry);
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
        owner: "worker-dead",
        generation: 1,
        expiresAt: LATER,
      }),
    );
    runs.clock = { now: () => EXPIRED };

    await tick.execute();
    await tick.execute();

    expect(
      telemetry.countersNamed(OSVA_METRIC.RECOVERY_LEASE_INTERRUPTED),
    ).toHaveLength(1);
    expect(
      telemetry.histogramsNamed(OSVA_METRIC.RECOVERY_DURATION_MS).length,
    ).toBeGreaterThan(0);
  });

  it("does not count a lost CAS as a successful lease recovery", async () => {
    const telemetry = new RecordingInstrumentation();
    const { runs, tick } = await harness(telemetry);
    const pending = await runs.findRunAttemptById(runAttemptId);
    if (pending === null) {
      throw new Error("expected persisted run");
    }

    runs.listExpiredLeasedRunningAttempts = async () => [pending];
    runs.failExpiredLeasedAttempt = async () => null;

    await tick.execute();

    expect(
      telemetry.countersNamed(OSVA_METRIC.RECOVERY_LEASE_INTERRUPTED),
    ).toHaveLength(0);
    expect(telemetry.countersNamed(OSVA_METRIC.RECOVERY_ERRORS)).toHaveLength(
      0,
    );
  });

  it("counts lease and transport operation failures separately from successes", async () => {
    const telemetry = new RecordingInstrumentation();
    const { runs, queue, tick } = await harness(telemetry);
    const pending = await runs.findRunAttemptById(runAttemptId);
    if (pending === null) {
      throw new Error("expected persisted run");
    }

    runs.listExpiredLeasedRunningAttempts = async () => [pending];
    runs.failExpiredLeasedAttempt = async () => {
      throw new Error("lease cas failed");
    };
    queue.enqueue = async () => {
      throw new Error("valkey down");
    };

    await tick.execute();

    expect(
      telemetry.countersNamed(OSVA_METRIC.RECOVERY_LEASE_INTERRUPTED),
    ).toHaveLength(0);
    expect(
      telemetry.countersNamed(OSVA_METRIC.RECOVERY_TRANSPORT_REPAIRED),
    ).toHaveLength(0);
    expect(
      telemetry
        .countersNamed(OSVA_METRIC.RECOVERY_ERRORS)
        .map((metric) => metric.attributes?.kind),
    ).toEqual(["lease", "transport"]);
  });

  it("counts ticker failures when the authoritative scan throws", async () => {
    const telemetry = new RecordingInstrumentation();
    const { runs, tick } = await harness(telemetry);
    runs.listExpiredLeasedRunningAttempts = async () => {
      throw new Error("postgres unavailable");
    };

    await expect(tick.execute()).rejects.toThrow("postgres unavailable");
    expect(
      telemetry
        .countersNamed(OSVA_METRIC.RECOVERY_ERRORS)
        .map((metric) => metric.attributes?.kind),
    ).toEqual(["tick"]);
  });
});

async function harness(instrumentation?: RecordingInstrumentation) {
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
    instrumentation,
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
