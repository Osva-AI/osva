import type {
  ExecutionRequest,
  RunAttemptState,
  RunState,
} from "@osva/contracts";
import {
  FakeRuntimeAdapter,
  MemoryAgentRepository,
  MemoryJobQueue,
  MemoryRunRepository,
  MemoryWorkspaceRepository,
} from "@osva/adapters-memory";
import {
  AgentVersion,
  isTerminalRunAttemptState,
  Run,
  RunAttempt,
} from "@osva/domain";
import { describe, expect, it } from "vitest";

import { CreateRun } from "../src/create-run.js";
import {
  BindingMismatchError,
  IdentityMismatchError,
  InvalidPersistedStateError,
} from "../src/errors.js";
import { ExecuteRunAttempt } from "../src/execute-run-attempt.js";
import {
  LATER,
  NOW,
  RUN_INPUT,
  agentId,
  agentVersionId,
  createBindings,
  createManifest,
  otherAgentId,
  otherAgentVersionId,
  otherRunId,
  runAttemptId,
  runId,
  seedAgentGraph,
  workspaceId,
  wrapAgentRepository,
  wrapRunRepository,
} from "./fixtures.js";

async function queuedAttempt(options?: {
  readonly timeoutMs?: number;
  readonly runtime?: FakeRuntimeAdapter;
}) {
  const workspaces = new MemoryWorkspaceRepository();
  const agents = new MemoryAgentRepository();
  const runs = new MemoryRunRepository();
  const queue = new MemoryJobQueue();
  const received: ExecutionRequest[] = [];
  await seedAgentGraph(workspaces, agents, {
    timeoutMs: options?.timeoutMs,
  });

  const createRun = new CreateRun({ runs, agents, queue });
  await createRun.execute({
    runId,
    runAttemptId,
    workspaceId,
    agentId,
    effectiveBindings: createBindings(),
    input: RUN_INPUT,
    now: NOW,
  });

  const executeRunAttempt = new ExecuteRunAttempt({
    runs,
    agents,
    runtime:
      options?.runtime ??
      new FakeRuntimeAdapter(async (request) => {
        received.push(request);
        return { status: "succeeded", output: { ok: true } };
      }),
  });

  return { agents, runs, queue, received, executeRunAttempt };
}

describe("ExecuteRunAttempt", () => {
  it("records ExecutionFailure on Run and RunAttempt without retrying", async () => {
    const { runs, executeRunAttempt } = await queuedAttempt({
      runtime: new FakeRuntimeAdapter(async () => ({
        status: "failed",
        error: { code: "AGENT_ERROR", message: "agent rejected input" },
      })),
    });

    const result = await executeRunAttempt.execute({
      runAttemptId,
      now: LATER,
    });

    expect(result.outcome).toBe("failed");
    if (result.outcome !== "failed") {
      return;
    }

    expect(result.result).toEqual({
      status: "failed",
      error: { code: "AGENT_ERROR", message: "agent rejected input" },
    });
    expect(result.run.status).toBe("FAILED");
    expect(result.runAttempt.status).toBe("FAILED");
    expect(result.runAttempt.error).toEqual({
      code: "AGENT_ERROR",
      message: "agent rejected input",
    });

    const persistedRun = await runs.findRunById(runId);
    const persistedAttempt = await runs.findRunAttemptById(runAttemptId);
    expect(persistedRun?.status).toBe("FAILED");
    expect(persistedAttempt?.status).toBe("FAILED");
    expect(persistedAttempt?.error).toEqual({
      code: "AGENT_ERROR",
      message: "agent rejected input",
    });
  });

  it("converts RuntimeAdapter throws into FAILED snapshots without persisting Error objects", async () => {
    const thrown = new Error("adapter exploded");
    const { runs, executeRunAttempt } = await queuedAttempt({
      runtime: new FakeRuntimeAdapter(async () => {
        throw thrown;
      }),
    });

    const result = await executeRunAttempt.execute({
      runAttemptId,
      now: LATER,
    });

    expect(result.outcome).toBe("failed");
    if (result.outcome !== "failed") {
      return;
    }

    expect(result.result.error).toEqual({
      code: "RUNTIME_ADAPTER_ERROR",
      message: "adapter exploded",
    });
    expect(result.run.status).toBe("FAILED");
    expect(result.runAttempt.status).toBe("FAILED");
    expect(result.runAttempt.error).toEqual({
      code: "RUNTIME_ADAPTER_ERROR",
      message: "adapter exploded",
    });

    const persisted = await runs.findRunAttemptById(runAttemptId);
    expect(persisted?.status).toBe("FAILED");
    expect(JSON.stringify(persisted?.error)).not.toContain("stack");
    expect(persisted?.error).not.toHaveProperty("name");
    expect(await runs.findRunById(runId)).toMatchObject({ status: "FAILED" });
  });

  it("treats terminal-attempt redelivery as an idempotent no-op", async () => {
    let executions = 0;
    const { executeRunAttempt } = await queuedAttempt({
      runtime: new FakeRuntimeAdapter(async () => {
        executions += 1;
        return { status: "succeeded", output: { ok: true } };
      }),
    });

    const first = await executeRunAttempt.execute({
      runAttemptId,
      now: LATER,
    });
    const second = await executeRunAttempt.execute({
      runAttemptId,
      now: LATER,
    });

    expect(first.outcome).toBe("succeeded");
    expect(second.outcome).toBe("already-terminal");
    expect(executions).toBe(1);
  });

  it("does not re-execute a RUNNING attempt", async () => {
    let executions = 0;
    const { agents, runs } = await queuedAttempt();
    const pending = await runs.findRunAttemptById(runAttemptId);
    const queued = await runs.findRunById(runId);
    if (pending === null || queued === null) {
      throw new Error("expected persisted Run and RunAttempt");
    }

    await runs.saveRunAttempt(pending.transitionTo("RUNNING", LATER));
    await runs.saveRun(queued.transitionTo("RUNNING", LATER));

    const executeRunAttempt = new ExecuteRunAttempt({
      runs,
      agents,
      runtime: new FakeRuntimeAdapter(async () => {
        executions += 1;
        return { status: "succeeded", output: { ok: true } };
      }),
    });

    const result = await executeRunAttempt.execute({
      runAttemptId,
      now: LATER,
    });

    expect(result.outcome).toBe("already-in-progress");
    expect(executions).toBe(0);
    expect((await runs.findRunById(runId))?.status).toBe("RUNNING");
    expect((await runs.findRunAttemptById(runAttemptId))?.status).toBe(
      "RUNNING",
    );
  });

  it("rejects a RunAttempt whose runId does not match the loaded Run", async () => {
    const { agents, runs } = await queuedAttempt();
    const otherRun = Run.create({
      id: otherRunId,
      workspaceId,
      agentId,
      effectiveBindings: createBindings(),
      input: RUN_INPUT,
      createdAt: NOW,
    });

    const mismatched = wrapRunRepository(runs, {
      async findRunById() {
        return otherRun;
      },
    });

    const executeMismatched = new ExecuteRunAttempt({
      runs: mismatched,
      agents,
      runtime: new FakeRuntimeAdapter(async () => ({
        status: "succeeded",
        output: { ok: true },
      })),
    });

    await expect(
      executeMismatched.execute({ runAttemptId, now: LATER }),
    ).rejects.toBeInstanceOf(IdentityMismatchError);
  });

  it("rejects an AgentVersion that does not match effective bindings", async () => {
    const { agents, runs } = await queuedAttempt();
    const otherVersion = AgentVersion.create({
      id: otherAgentVersionId,
      agentId,
      version: 2,
      manifest: createManifest(),
      createdAt: NOW,
    });

    const executeMismatched = new ExecuteRunAttempt({
      runs,
      agents: wrapAgentRepository(agents, {
        async findAgentVersionById() {
          return otherVersion;
        },
      }),
      runtime: new FakeRuntimeAdapter(async () => ({
        status: "succeeded",
        output: { ok: true },
      })),
    });

    await expect(
      executeMismatched.execute({ runAttemptId, now: LATER }),
    ).rejects.toBeInstanceOf(BindingMismatchError);
  });

  it("rejects PENDING execution while the logical Run is not QUEUED", async () => {
    const workspaces = new MemoryWorkspaceRepository();
    const agents = new MemoryAgentRepository();
    const runs = new MemoryRunRepository();
    await seedAgentGraph(workspaces, agents);

    await runs.saveRun(
      Run.create({
        id: runId,
        workspaceId,
        agentId,
        effectiveBindings: createBindings(),
        input: RUN_INPUT,
        createdAt: NOW,
      }),
    );
    await runs.saveRunAttempt(
      RunAttempt.createFirst({
        id: runAttemptId,
        runId,
        createdAt: NOW,
      }),
    );

    const executeRunAttempt = new ExecuteRunAttempt({
      runs,
      agents,
      runtime: new FakeRuntimeAdapter(async () => ({
        status: "succeeded",
        output: { ok: true },
      })),
    });

    await expect(
      executeRunAttempt.execute({ runAttemptId, now: LATER }),
    ).rejects.toBeInstanceOf(InvalidPersistedStateError);

    expect((await runs.findRunById(runId))?.status).toBe("PENDING");
    expect((await runs.findRunAttemptById(runAttemptId))?.status).toBe(
      "PENDING",
    );
  });

  it("preserves model-profile bindings and AgentVersion timeout on ExecutionRequest", async () => {
    const received: ExecutionRequest[] = [];
    const { executeRunAttempt } = await queuedAttempt({
      timeoutMs: 9_001,
      runtime: new FakeRuntimeAdapter(async (request) => {
        received.push(request);
        return { status: "succeeded", output: { ok: true } };
      }),
    });

    await executeRunAttempt.execute({ runAttemptId, now: LATER });

    expect(received[0]?.timeoutMs).toBe(9_001);
    expect(received[0]?.modelProfileVersionBindings).toEqual(
      createBindings().modelProfileVersionBindings,
    );
    expect(received[0]?.input).toEqual(RUN_INPUT);
  });

  it("rejects an AgentVersion owned by a different Agent", async () => {
    const { agents, runs } = await queuedAttempt();
    const spoofed = AgentVersion.create({
      id: agentVersionId,
      agentId: otherAgentId,
      version: 1,
      manifest: createManifest(),
      createdAt: NOW,
    });

    const executeMismatched = new ExecuteRunAttempt({
      runs,
      agents: wrapAgentRepository(agents, {
        async findAgentVersionById() {
          return spoofed;
        },
      }),
      runtime: new FakeRuntimeAdapter(async () => ({
        status: "succeeded",
        output: { ok: true },
      })),
    });

    await expect(
      executeMismatched.execute({ runAttemptId, now: LATER }),
    ).rejects.toBeInstanceOf(BindingMismatchError);
  });

  it("treats compatible FAILED redelivery as an idempotent no-op", async () => {
    let executions = 0;
    const { executeRunAttempt } = await queuedAttempt({
      runtime: new FakeRuntimeAdapter(async () => {
        executions += 1;
        return {
          status: "failed",
          error: { code: "AGENT_ERROR", message: "failed once" },
        };
      }),
    });

    const first = await executeRunAttempt.execute({
      runAttemptId,
      now: LATER,
    });
    const second = await executeRunAttempt.execute({
      runAttemptId,
      now: LATER,
    });

    expect(first.outcome).toBe("failed");
    expect(second.outcome).toBe("already-terminal");
    expect(executions).toBe(1);
  });

  it.each([
    ["TIMED_OUT", "TIMED_OUT"],
    ["CANCELLED", "CANCELLED"],
  ] as const)(
    "treats compatible %s/%s redelivery as an idempotent no-op",
    async (attemptStatus, runStatus) => {
      let executions = 0;
      const { agents, runs } = await queuedAttempt();
      await persistPair(runs, attemptStatus, runStatus);

      const executeRunAttempt = new ExecuteRunAttempt({
        runs,
        agents,
        runtime: new FakeRuntimeAdapter(async () => {
          executions += 1;
          return { status: "succeeded", output: { ok: true } };
        }),
      });

      const result = await executeRunAttempt.execute({
        runAttemptId,
        now: LATER,
      });

      expect(result.outcome).toBe("already-terminal");
      expect(executions).toBe(0);
      expect((await runs.findRunById(runId))?.status).toBe(runStatus);
      expect((await runs.findRunAttemptById(runAttemptId))?.status).toBe(
        attemptStatus,
      );
    },
  );

  it.each([
    ["SUCCEEDED", "FAILED"],
    ["FAILED", "SUCCEEDED"],
    ["TIMED_OUT", "FAILED"],
    ["CANCELLED", "RUNNING"],
  ] as const)(
    "rejects incompatible terminal redelivery when attempt is %s and Run is %s",
    async (attemptStatus, runStatus) => {
      let executions = 0;
      const { agents, runs } = await queuedAttempt();
      await persistPair(runs, attemptStatus, runStatus);

      const executeRunAttempt = new ExecuteRunAttempt({
        runs,
        agents,
        runtime: new FakeRuntimeAdapter(async () => {
          executions += 1;
          return { status: "succeeded", output: { ok: true } };
        }),
      });

      await expect(
        executeRunAttempt.execute({ runAttemptId, now: LATER }),
      ).rejects.toBeInstanceOf(InvalidPersistedStateError);

      expect(executions).toBe(0);
      expect((await runs.findRunById(runId))?.status).toBe(runStatus);
      expect((await runs.findRunAttemptById(runAttemptId))?.status).toBe(
        attemptStatus,
      );
    },
  );

  it("rejects a RUNNING attempt when the Run is not RUNNING", async () => {
    let executions = 0;
    const { agents, runs } = await queuedAttempt();
    await persistPair(runs, "RUNNING", "QUEUED");

    const executeRunAttempt = new ExecuteRunAttempt({
      runs,
      agents,
      runtime: new FakeRuntimeAdapter(async () => {
        executions += 1;
        return { status: "succeeded", output: { ok: true } };
      }),
    });

    await expect(
      executeRunAttempt.execute({ runAttemptId, now: LATER }),
    ).rejects.toBeInstanceOf(InvalidPersistedStateError);

    expect(executions).toBe(0);
    expect((await runs.findRunById(runId))?.status).toBe("QUEUED");
    expect((await runs.findRunAttemptById(runAttemptId))?.status).toBe(
      "RUNNING",
    );
  });
});

async function persistPair(
  runs: MemoryRunRepository,
  attemptStatus: RunAttemptState,
  runStatus: RunState,
): Promise<void> {
  const existingAttempt = await runs.findRunAttemptById(runAttemptId);
  const existingRun = await runs.findRunById(runId);
  if (existingAttempt === null || existingRun === null) {
    throw new Error("expected persisted Run and RunAttempt");
  }

  await runs.saveRunAttempt(
    RunAttempt.rehydrate({
      id: existingAttempt.id,
      runId: existingAttempt.runId,
      sequence: existingAttempt.sequence,
      status: attemptStatus,
      createdAt: existingAttempt.createdAt,
      startedAt: attemptStatus === "PENDING" ? undefined : LATER,
      completedAt: isTerminalRunAttemptState(attemptStatus) ? LATER : undefined,
    }),
  );
  await runs.saveRun(
    Run.rehydrate({
      id: existingRun.id,
      workspaceId: existingRun.workspaceId,
      agentId: existingRun.agentId,
      status: runStatus,
      effectiveBindings: existingRun.effectiveBindings,
      input: existingRun.input,
      createdAt: existingRun.createdAt,
      updatedAt: LATER,
      idempotencyKey: existingRun.idempotencyKey,
    }),
  );
}
