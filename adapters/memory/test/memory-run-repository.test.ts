import type { RunAttemptId, RunId } from "@osva/contracts";
import {
  DomainInvariantError,
  InvalidRunAttemptTransitionError,
  InvalidRunTransitionError,
  LifecycleConflictError,
  Run,
  RunAttempt,
  RunNotFoundError,
  RunStep,
} from "@osva/domain";
import type { RunRepository } from "@osva/domain";
import { describe, expect, it } from "vitest";

import { MemoryRunRepository } from "../src/memory-run-repository.js";
import {
  agentId,
  createBindings,
  LATER,
  NOW,
  otherAgentId,
  otherAgentVersionId,
  otherRunId,
  RUN_INPUT,
  runAttemptId,
  runId,
  runStepId,
  secondAttemptId,
  workspaceId,
} from "./fixtures.js";

function createPendingRun(id: RunId = runId, createdAt: Date = NOW): Run {
  return Run.create({
    id,
    workspaceId,
    agentId,
    effectiveBindings: createBindings(),
    input: RUN_INPUT,
    createdAt,
  });
}

function createPendingAttempt(
  id: RunAttemptId = runAttemptId,
  ownerRunId: RunId = runId,
): RunAttempt {
  return RunAttempt.createFirst({
    id,
    runId: ownerRunId,
    createdAt: NOW,
  });
}

describe("MemoryRunRepository", () => {
  it("creates a Run and initial RunAttempt atomically", async () => {
    const repository = new MemoryRunRepository();
    const pending = createPendingRun();
    const attempt = createPendingAttempt();

    await repository.createRunWithInitialAttempt(pending, attempt);

    expect(await repository.findRunById(runId)).toEqual(pending);
    expect(await repository.findRunAttemptById(runAttemptId)).toEqual(attempt);
  });

  it("rolls back the Run when the initial RunAttempt cannot persist", async () => {
    const repository = new MemoryRunRepository();
    await repository.createRunWithInitialAttempt(
      createPendingRun(),
      createPendingAttempt(),
    );

    const extraRun = createPendingRun("run-extra" as RunId);
    await expect(
      repository.createRunWithInitialAttempt(
        extraRun,
        createPendingAttempt(runAttemptId, extraRun.id),
      ),
    ).rejects.toBeInstanceOf(DomainInvariantError);

    expect(await repository.findRunById(extraRun.id)).toBeNull();
    expect((await repository.findRunAttemptById(runAttemptId))?.runId).toBe(
      runId,
    );
  });

  it("transitions a Run with expected-state semantics", async () => {
    const repository: RunRepository = new MemoryRunRepository();
    const pending = createPendingRun();
    await repository.saveRun(pending);

    const queued = pending.transitionTo("QUEUED", LATER);
    const stored = await repository.transitionRun("PENDING", queued);

    expect(stored.status).toBe("QUEUED");
    expect(stored.updatedAt.getTime()).toBe(LATER.getTime());
    expect(stored.createdAt.getTime()).toBe(NOW.getTime());
    expect(stored.input).toEqual(RUN_INPUT);
  });

  it("rejects a second competing Run transition from the same expected state", async () => {
    const repository = new MemoryRunRepository();
    const pending = createPendingRun();
    await repository.saveRun(pending);

    await repository.transitionRun(
      "PENDING",
      pending.transitionTo("QUEUED", LATER),
    );

    await expect(
      repository.transitionRun(
        "PENDING",
        pending.transitionTo("QUEUED", LATER),
      ),
    ).rejects.toBeInstanceOf(LifecycleConflictError);
  });

  it("rejects invalid Stage 0 Run transitions", async () => {
    const repository = new MemoryRunRepository();
    const pending = createPendingRun();
    await repository.saveRun(pending);

    await expect(
      repository.transitionRun(
        "PENDING",
        Run.rehydrate({
          id: pending.id,
          workspaceId: pending.workspaceId,
          agentId: pending.agentId,
          status: "SUCCEEDED",
          effectiveBindings: pending.effectiveBindings,
          input: pending.input,
          createdAt: pending.createdAt,
          updatedAt: LATER,
        }),
      ),
    ).rejects.toBeInstanceOf(InvalidRunTransitionError);
  });

  it("does not overwrite immutable Run identity or input through lifecycle updates", async () => {
    const repository = new MemoryRunRepository();
    const pending = createPendingRun();
    await repository.saveRun(pending);

    const spoofed = Run.rehydrate({
      id: pending.id,
      workspaceId: pending.workspaceId,
      agentId: otherAgentId,
      status: "QUEUED",
      effectiveBindings: createBindings(otherAgentVersionId),
      input: { mutated: true },
      createdAt: LATER,
      updatedAt: LATER,
      idempotencyKey: "changed",
    });

    const stored = await repository.transitionRun("PENDING", spoofed);
    expect(stored.agentId).toBe(agentId);
    expect(stored.effectiveBindings.agentVersionId).toBe(
      pending.effectiveBindings.agentVersionId,
    );
    expect(stored.input).toEqual(RUN_INPUT);
    expect(stored.createdAt.getTime()).toBe(NOW.getTime());
    expect(stored.idempotencyKey).toBeUndefined();
  });

  it("allows legitimate RunAttempt state progression", async () => {
    const repository: RunRepository = new MemoryRunRepository();
    const pending = createPendingAttempt();
    await repository.saveRunAttempt(pending);

    const running = await repository.transitionRunAttempt(
      "PENDING",
      pending.transitionTo("RUNNING", LATER),
    );

    expect(running.status).toBe("RUNNING");
    expect(running.id).toBe(runAttemptId);
    expect(running.sequence).toBe(1);
  });

  it("rejects invalid Stage 0 RunAttempt transitions", async () => {
    const repository = new MemoryRunRepository();
    const pending = createPendingAttempt();
    await repository.saveRunAttempt(pending);

    await expect(
      repository.transitionRunAttempt(
        "PENDING",
        pending
          .transitionTo("RUNNING", LATER)
          .transitionTo("SUCCEEDED", LATER, {
            output: { ok: true },
          }),
      ),
    ).rejects.toBeInstanceOf(InvalidRunAttemptTransitionError);
  });

  it("does not move a RunAttempt to another Run through lifecycle updates", async () => {
    const repository = new MemoryRunRepository();
    const pending = createPendingAttempt();
    await repository.saveRunAttempt(pending);

    const spoofed = RunAttempt.rehydrate({
      id: pending.id,
      runId: otherRunId,
      sequence: 99,
      status: "RUNNING",
      createdAt: LATER,
      startedAt: LATER,
    });

    const stored = await repository.transitionRunAttempt("PENDING", spoofed);
    expect(stored.runId).toBe(runId);
    expect(stored.sequence).toBe(1);
    expect(stored.createdAt.getTime()).toBe(NOW.getTime());
  });

  it("lists attempts for one Run in ascending sequence without leaking others", async () => {
    const repository: RunRepository = new MemoryRunRepository();
    const first = createPendingAttempt();
    const second = RunAttempt.createSubsequent(
      first.transitionTo("RUNNING", LATER).transitionTo("FAILED", LATER),
      { id: secondAttemptId, createdAt: LATER },
    );
    const other = createPendingAttempt(
      "other-attempt" as RunAttemptId,
      otherRunId,
    );

    await repository.saveRunAttempt(second);
    await repository.saveRunAttempt(other);
    await repository.saveRunAttempt(first);

    const listed = await repository.listRunAttempts(runId);
    expect(listed.map((attempt) => attempt.id)).toEqual([
      runAttemptId,
      secondAttemptId,
    ]);
    expect(listed.map((attempt) => attempt.sequence)).toEqual([1, 2]);

    const otherListed = await repository.listRunAttempts(otherRunId);
    expect(otherListed.map((attempt) => attempt.id)).toEqual(["other-attempt"]);
  });

  it("lists Runs by createdAt DESC then id DESC and tie-breaks equal timestamps", async () => {
    const repository = new MemoryRunRepository();
    await repository.saveRun(createPendingRun("run-a" as RunId, NOW));
    await repository.saveRun(createPendingRun("run-c" as RunId, NOW));
    await repository.saveRun(createPendingRun("run-b" as RunId, NOW));

    const firstPage = await repository.listRuns({ limit: 2 });
    expect(firstPage.runs.map((run) => run.id)).toEqual(["run-c", "run-b"]);
    expect(firstPage.nextCursor?.id).toBe("run-b");

    const secondPage = await repository.listRuns({
      limit: 2,
      cursor: firstPage.nextCursor,
    });
    expect(secondPage.runs.map((run) => run.id)).toEqual(["run-a"]);
    expect(secondPage.nextCursor).toBeUndefined();
  });

  it("filters listed Runs by agentId, agentVersionId, and status", async () => {
    const repository = new MemoryRunRepository();
    const matching = Run.create({
      id: runId,
      workspaceId,
      agentId,
      effectiveBindings: createBindings(),
      input: RUN_INPUT,
      createdAt: NOW,
    });
    const otherAgent = Run.create({
      id: otherRunId,
      workspaceId,
      agentId: otherAgentId,
      effectiveBindings: createBindings(otherAgentVersionId),
      input: RUN_INPUT,
      createdAt: NOW,
    });
    await repository.saveRun(matching);
    await repository.saveRun(otherAgent);
    await repository.transitionRun(
      "PENDING",
      matching.transitionTo("QUEUED", LATER),
    );

    const byAgent = await repository.listRuns({
      limit: 50,
      agentId,
    });
    expect(byAgent.runs.map((run) => run.id)).toEqual([runId]);

    const byVersion = await repository.listRuns({
      limit: 50,
      agentVersionId: otherAgentVersionId,
    });
    expect(byVersion.runs.map((run) => run.id)).toEqual([otherRunId]);

    const byStatus = await repository.listRuns({
      limit: 50,
      status: "QUEUED",
    });
    expect(byStatus.runs.map((run) => run.id)).toEqual([runId]);
  });

  it("rejects insert-only saveRun when the Run already exists", async () => {
    const repository = new MemoryRunRepository();
    const pending = createPendingRun();
    await repository.saveRun(pending);

    await expect(repository.saveRun(pending)).rejects.toBeInstanceOf(
      DomainInvariantError,
    );
  });

  it("throws RunNotFoundError when transitioning a missing Run", async () => {
    const repository = new MemoryRunRepository();
    await expect(
      repository.transitionRun(
        "PENDING",
        createPendingRun().transitionTo("QUEUED", LATER),
      ),
    ).rejects.toBeInstanceOf(RunNotFoundError);
  });

  it("stores a RunStep that retains both runId and runAttemptId", async () => {
    const repository = new MemoryRunRepository();
    const port: RunRepository = repository;
    const step = RunStep.create({
      id: runStepId,
      runId,
      runAttemptId,
      type: "model.generate",
      name: "generate",
      startedAt: NOW,
    });

    await port.saveRunStep(step);

    const stored = repository.listRunSteps();
    expect(stored).toHaveLength(1);
    expect(stored[0]?.runId).toBe(runId);
    expect(stored[0]?.runAttemptId).toBe(runAttemptId);
    expect(Object.isFrozen(stored)).toBe(true);
    expect(() => {
      (stored as RunStep[]).pop();
    }).toThrow(TypeError);
    expect(repository.listRunSteps()).toHaveLength(1);
  });
});
