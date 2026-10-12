import { EXECUTION_INTERRUPTED_ERROR_CODE } from "@osva-ai/contracts";
import {
  FakeRuntimeAdapter,
  MemoryAgentRepository,
  MemoryJobQueue,
  MemoryRunRepository,
  MemoryWorkspaceRepository,
} from "@osva/adapters-memory";
import { LifecycleConflictError, RunAttempt } from "@osva/domain";
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

describe("M9.3 failure-injection matrix", () => {
  it("1. crash before PENDING → RUNNING is repaired and executed once", async () => {
    const ctx = await setup();
    await ctx.queue.cancel(runAttemptId);
    await ctx.tick.execute();
    expect(ctx.queue.pendingRunAttemptIds()).toEqual([runAttemptId]);

    const result = await ctx.execute.execute({ runAttemptId, now: LATER });
    expect(result.outcome).toBe("succeeded");
    expect(ctx.executions).toBe(1);
  });

  it("2. crash immediately after RUNNING acquisition never re-executes", async () => {
    const ctx = await setup();
    const pending = await ctx.runs.findRunAttemptById(runAttemptId);
    const queued = await ctx.runs.findRunById(runId);
    if (pending === null || queued === null) {
      throw new Error("expected persisted run");
    }
    await ctx.runs.transitionRunAndAttempt(
      queued.status,
      queued.transitionTo("RUNNING", LATER),
      pending.status,
      pending.transitionTo("RUNNING", LATER).withExecutionLease({
        owner: "crashed-worker",
        generation: 1,
        expiresAt: LATER,
      }),
    );

    const redelivery = await ctx.execute.execute({
      runAttemptId,
      now: LATER,
    });
    expect(redelivery.outcome).toBe("already-in-progress");
    expect(ctx.executions).toBe(0);

    ctx.runs.clock = { now: () => EXPIRED };
    await ctx.tick.execute();
    expect((await ctx.runs.findRunAttemptById(runAttemptId))?.status).toBe(
      "FAILED",
    );
    expect((await ctx.runs.findRunAttemptById(runAttemptId))?.error?.code).toBe(
      EXECUTION_INTERRUPTED_ERROR_CODE,
    );

    const afterFail = await ctx.execute.execute({
      runAttemptId,
      now: EXPIRED,
    });
    expect(afterFail.outcome).toBe("already-terminal");
    expect(ctx.executions).toBe(0);
  });

  it("3. crash during runtime execution fails the same attempt", async () => {
    const ctx = await setup({
      runtime: async () => {
        ctx.runs.clock = { now: () => EXPIRED };
        await ctx.tick.execute();
        return { status: "succeeded", output: { late: true } };
      },
    });

    const result = await ctx.execute.execute({ runAttemptId, now: LATER });
    expect(result.outcome).toBe("ownership-lost");
    expect((await ctx.runs.findRunAttemptById(runAttemptId))?.status).toBe(
      "FAILED",
    );
    expect((await ctx.runs.findRunAttemptById(runAttemptId))?.error?.code).toBe(
      EXECUTION_INTERRUPTED_ERROR_CODE,
    );
    expect(ctx.executions).toBe(1);
  });

  it("4. crash after side effect before outcome persistence does not record success", async () => {
    const ctx = await setup({
      runtime: async () => {
        ctx.sideEffects += 1;
        ctx.runs.clock = { now: () => EXPIRED };
        await ctx.tick.execute();
        return { status: "succeeded", output: { sideEffect: true } };
      },
    });

    const result = await ctx.execute.execute({ runAttemptId, now: LATER });
    expect(result.outcome).toBe("ownership-lost");
    expect(ctx.sideEffects).toBe(1);
    expect((await ctx.runs.findRunAttemptById(runAttemptId))?.status).toBe(
      "FAILED",
    );
    expect(
      (await ctx.runs.findRunAttemptById(runAttemptId))?.output,
    ).toBeUndefined();
  });

  it("5. crash after terminal persistence is an idempotent no-op", async () => {
    const ctx = await setup();
    const first = await ctx.execute.execute({ runAttemptId, now: LATER });
    expect(first.outcome).toBe("succeeded");
    const second = await ctx.execute.execute({ runAttemptId, now: LATER });
    expect(second.outcome).toBe("already-terminal");
    expect(ctx.executions).toBe(1);
  });

  it("6. lost Valkey queue delivery is repaired with the same RunAttempt id", async () => {
    const ctx = await setup();
    await ctx.queue.cancel(runAttemptId);
    await ctx.tick.execute();
    expect(ctx.queue.pendingRunAttemptIds()).toEqual([runAttemptId]);
    expect((await ctx.runs.findRunAttemptById(runAttemptId))?.status).toBe(
      "PENDING",
    );
  });

  it("7. two workers acquiring one attempt execute runtime once", async () => {
    const ctx = await setup();
    const first = ctx.execute.execute({ runAttemptId, now: LATER });
    const second = ctx.execute.execute({ runAttemptId, now: LATER });
    const results = await Promise.all([first, second]);
    const outcomes = results.map((result) => result.outcome).sort();
    expect(outcomes).toEqual(["already-in-progress", "succeeded"].sort());
    expect(ctx.executions).toBe(1);
  });

  it("8. heartbeat loss rejects late terminal success", async () => {
    let fireHeartbeat: (() => Promise<void>) | undefined;
    const ctx = await setup({
      heartbeat: {
        start(tick) {
          fireHeartbeat = tick;
          return () => {
            fireHeartbeat = undefined;
          };
        },
      },
      runtime: async () => {
        ctx.runs.clock = { now: () => EXPIRED };
        await fireHeartbeat?.();
        return { status: "succeeded", output: { late: true } };
      },
    });

    const result = await ctx.execute.execute({ runAttemptId, now: LATER });
    expect(result.outcome).toBe("ownership-lost");
    expect((await ctx.runs.findRunAttemptById(runAttemptId))?.status).toBe(
      "RUNNING",
    );
  });

  it("9. sweeper loses the race against a live heartbeat", async () => {
    const ctx = await setup();
    const pending = await ctx.runs.findRunAttemptById(runAttemptId);
    const queued = await ctx.runs.findRunById(runId);
    if (pending === null || queued === null) {
      throw new Error("expected persisted run");
    }
    await ctx.runs.transitionRunAndAttempt(
      queued.status,
      queued.transitionTo("RUNNING", LATER),
      pending.status,
      pending.transitionTo("RUNNING", LATER).withExecutionLease({
        owner: "live-worker",
        generation: 1,
        expiresAt: new Date(LATER.getTime() + 1),
      }),
    );
    const renewed = await ctx.runs.renewExecutionLease({
      runAttemptId,
      owner: "live-worker",
      generation: 1,
      ttlMs: 60_000,
      now: LATER,
    });
    expect(renewed).toBe(true);
    ctx.runs.clock = { now: () => LATER };
    await ctx.tick.execute();
    expect((await ctx.runs.findRunAttemptById(runAttemptId))?.status).toBe(
      "RUNNING",
    );
  });

  it("10. sweeper restart mid-batch is idempotent", async () => {
    const ctx = await setup();
    const pending = await ctx.runs.findRunAttemptById(runAttemptId);
    const queued = await ctx.runs.findRunById(runId);
    if (pending === null || queued === null) {
      throw new Error("expected persisted run");
    }
    await ctx.runs.transitionRunAndAttempt(
      queued.status,
      queued.transitionTo("RUNNING", LATER),
      pending.status,
      pending.transitionTo("RUNNING", LATER).withExecutionLease({
        owner: "dead-worker",
        generation: 1,
        expiresAt: LATER,
      }),
    );
    ctx.runs.clock = { now: () => EXPIRED };
    await ctx.tick.execute();
    await ctx.tick.execute();
    expect((await ctx.runs.findRunAttemptById(runAttemptId))?.error?.code).toBe(
      EXECUTION_INTERRUPTED_ERROR_CODE,
    );
    expect((await ctx.runs.findRunById(runId))?.status).toBe("FAILED");
  });

  it("11. duplicate queue deliveries do not re-execute RUNNING or terminal attempts", async () => {
    const ctx = await setup();
    const first = await ctx.execute.execute({ runAttemptId, now: LATER });
    const duplicate = await ctx.execute.execute({ runAttemptId, now: LATER });
    expect(first.outcome).toBe("succeeded");
    expect(duplicate.outcome).toBe("already-terminal");
    expect(ctx.executions).toBe(1);
  });

  it("12. workflow-visible child interruption uses FAILED + EXECUTION_INTERRUPTED", async () => {
    const ctx = await setup();
    const pending = await ctx.runs.findRunAttemptById(runAttemptId);
    const queued = await ctx.runs.findRunById(runId);
    if (pending === null || queued === null) {
      throw new Error("expected persisted run");
    }
    await ctx.runs.transitionRunAndAttempt(
      queued.status,
      queued.transitionTo("RUNNING", LATER),
      pending.status,
      pending.transitionTo("RUNNING", LATER).withExecutionLease({
        owner: "dead-worker",
        generation: 1,
        expiresAt: LATER,
      }),
    );
    ctx.runs.clock = { now: () => EXPIRED };
    await ctx.tick.execute();
    const run = await ctx.runs.findRunById(runId);
    expect(run?.status).toBe("FAILED");
    expect((await ctx.runs.findRunAttemptById(runAttemptId))?.error?.code).toBe(
      EXECUTION_INTERRUPTED_ERROR_CODE,
    );
  });

  it("13. standalone HTTP CreateRun transport recovery uses the existing attempt", async () => {
    const ctx = await setup();
    await ctx.queue.cancel(runAttemptId);
    await ctx.tick.execute();
    const result = await ctx.execute.execute({ runAttemptId, now: LATER });
    expect(result.outcome).toBe("succeeded");
    expect(result.runAttempt.id).toBe(runAttemptId);
    expect(ctx.executions).toBe(1);
  });

  it("14. legacy unleased RUNNING rows are not silently failed or re-executed", async () => {
    const ctx = await setup();
    const pending = await ctx.runs.findRunAttemptById(runAttemptId);
    const queued = await ctx.runs.findRunById(runId);
    if (pending === null || queued === null) {
      throw new Error("expected persisted run");
    }
    await ctx.runs.transitionRunAndAttempt(
      queued.status,
      queued.transitionTo("RUNNING", LATER),
      pending.status,
      pending.transitionTo("RUNNING", LATER),
    );
    ctx.runs.clock = { now: () => EXPIRED };
    await ctx.tick.execute();
    expect((await ctx.runs.findRunAttemptById(runAttemptId))?.status).toBe(
      "RUNNING",
    );
    expect(
      (await ctx.runs.findRunAttemptById(runAttemptId))?.executionOwner,
    ).toBeUndefined();
    const redelivery = await ctx.execute.execute({
      runAttemptId,
      now: EXPIRED,
    });
    expect(redelivery.outcome).toBe("already-in-progress");
    expect(ctx.executions).toBe(0);
  });

  it("does not automatically invoke runtime.execute for abandoned RUNNING attempts", async () => {
    const ctx = await setup();
    const pending = await ctx.runs.findRunAttemptById(runAttemptId);
    const queued = await ctx.runs.findRunById(runId);
    if (pending === null || queued === null) {
      throw new Error("expected persisted run");
    }
    await ctx.runs.transitionRunAndAttempt(
      queued.status,
      queued.transitionTo("RUNNING", LATER),
      pending.status,
      pending.transitionTo("RUNNING", LATER).withExecutionLease({
        owner: "dead-worker",
        generation: 1,
        expiresAt: LATER,
      }),
    );
    ctx.runs.clock = { now: () => EXPIRED };
    await ctx.tick.execute();
    await ctx.execute.execute({ runAttemptId, now: EXPIRED });
    expect(ctx.executions).toBe(0);
  });

  it("rejects a stolen generation on terminal persist", async () => {
    const ctx = await setup();
    const pending = await ctx.runs.findRunAttemptById(runAttemptId);
    const queued = await ctx.runs.findRunById(runId);
    if (pending === null || queued === null) {
      throw new Error("expected persisted run");
    }
    const leased = pending.transitionTo("RUNNING", LATER).withExecutionLease({
      owner: "worker-a",
      generation: 1,
      expiresAt: EXPIRED,
    });
    await ctx.runs.transitionRunAndAttempt(
      queued.status,
      queued.transitionTo("RUNNING", LATER),
      pending.status,
      leased,
    );
    const stolen = RunAttempt.rehydrate({
      id: leased.id,
      runId: leased.runId,
      sequence: leased.sequence,
      status: "SUCCEEDED",
      createdAt: leased.createdAt,
      startedAt: leased.startedAt,
      completedAt: LATER,
      output: { stolen: true },
      executionOwner: "worker-b",
      executionGeneration: 1,
    });
    await expect(
      ctx.runs.transitionRunAndAttempt(
        "RUNNING",
        (await ctx.runs.findRunById(runId))!.transitionTo("SUCCEEDED", LATER),
        "RUNNING",
        stolen,
      ),
    ).rejects.toBeInstanceOf(LifecycleConflictError);
  });
});

async function setup(options?: {
  readonly runtime?: () => Promise<{
    readonly status: "succeeded" | "failed";
    readonly output?: unknown;
    readonly error?: { readonly code: string; readonly message: string };
  }>;
  readonly heartbeat?: {
    start(tick: () => Promise<void>, intervalMs: number): () => void;
  };
}) {
  const workspaces = new MemoryWorkspaceRepository();
  const agents = new MemoryAgentRepository();
  const runs = new MemoryRunRepository();
  runs.clock = { now: () => LATER };
  const queue = new MemoryJobQueue();
  const ctx = {
    executions: 0,
    sideEffects: 0,
    runs,
    queue,
    tick: undefined as unknown as ExecutionRecoveryTick,
    execute: undefined as unknown as ExecuteRunAttempt,
  };
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
  ctx.tick = new ExecutionRecoveryTick({
    runs,
    queue,
    clock: { now: () => runs.clock.now() },
  });
  ctx.execute = new ExecuteRunAttempt({
    runs,
    agents,
    leaseTtlMs: 30_000,
    heartbeatIntervalMs: options?.heartbeat ? 1 : 0,
    heartbeat: options?.heartbeat,
    runtime: new FakeRuntimeAdapter(async () => {
      ctx.executions += 1;
      if (options?.runtime) {
        const result = await options.runtime();
        if (result.status === "failed") {
          return {
            status: "failed",
            error: result.error ?? {
              code: "AGENT_ERROR",
              message: "failed",
            },
          };
        }
        return { status: "succeeded", output: result.output };
      }
      return { status: "succeeded", output: { ok: true } };
    }),
  });
  return ctx;
}
