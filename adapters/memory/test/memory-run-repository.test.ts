import type { RunAttemptId, RunId } from "@osva/contracts";
import { Run, RunAttempt, RunStep } from "@osva/domain";
import type { RunRepository } from "@osva/domain";
import { describe, expect, it } from "vitest";

import { MemoryRunRepository } from "../src/memory-run-repository.js";
import {
  agentId,
  createBindings,
  LATER,
  NOW,
  otherRunId,
  RUN_INPUT,
  runAttemptId,
  runId,
  runStepId,
  secondAttemptId,
  workspaceId,
} from "./fixtures.js";

function createRun(id: RunId = runId): Run {
  return Run.create({
    id,
    workspaceId,
    agentId,
    effectiveBindings: createBindings(),
    input: RUN_INPUT,
    createdAt: NOW,
  });
}

describe("MemoryRunRepository", () => {
  it("replaces a Run with its later transitioned snapshot", async () => {
    const repository: RunRepository = new MemoryRunRepository();
    const pending = createRun();
    await repository.saveRun(pending);

    const queued = pending.transitionTo("QUEUED", LATER);
    await repository.saveRun(queued);

    const stored = await repository.findRunById(runId);
    expect(stored?.status).toBe("QUEUED");
    expect(stored?.updatedAt.getTime()).toBe(LATER.getTime());
    expect(stored?.createdAt.getTime()).toBe(NOW.getTime());
    expect(stored?.input).toEqual(RUN_INPUT);
  });

  it("allows legitimate RunAttempt state progression", async () => {
    const repository: RunRepository = new MemoryRunRepository();
    const pending = RunAttempt.createFirst({
      id: runAttemptId,
      runId,
      createdAt: NOW,
    });
    await repository.saveRunAttempt(pending);

    const running = pending.transitionTo("RUNNING", LATER);
    await repository.saveRunAttempt(running);

    const stored = await repository.findRunAttemptById(runAttemptId);
    expect(stored?.status).toBe("RUNNING");
    expect(stored?.id).toBe(runAttemptId);
    expect(stored?.sequence).toBe(1);
  });

  it("lists attempts for one Run in ascending sequence without leaking others", async () => {
    const repository: RunRepository = new MemoryRunRepository();
    const first = RunAttempt.createFirst({
      id: runAttemptId,
      runId,
      createdAt: NOW,
    });
    const second = RunAttempt.createSubsequent(
      first.transitionTo("RUNNING", LATER).transitionTo("FAILED", LATER),
      { id: secondAttemptId, createdAt: LATER },
    );
    const other = RunAttempt.createFirst({
      id: "other-attempt" as RunAttemptId,
      runId: otherRunId,
      createdAt: NOW,
    });

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
