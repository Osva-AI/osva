import { describe, expect, it } from "vitest";

import { InvalidRunTransitionError } from "../src/errors.js";
import { Run } from "../src/run.js";
import { RunAttempt } from "../src/run-attempt.js";
import {
  agentId,
  createBindings,
  LATER,
  LATER_STILL,
  NOW,
  RUN_INPUT,
  runAttemptId,
  runId,
  workspaceId,
} from "./fixtures.js";

describe("Run creation vs rehydration", () => {
  it("creates a new Run in PENDING with updatedAt equal to createdAt", () => {
    const run = Run.create({
      id: runId,
      workspaceId,
      agentId,
      effectiveBindings: createBindings(),
      input: RUN_INPUT,
      createdAt: NOW,
      idempotencyKey: "idem-1",
    });

    expect(run.status).toBe("PENDING");
    expect(run.input).toEqual(RUN_INPUT);
    expect(run.createdAt.getTime()).toBe(NOW.getTime());
    expect(run.updatedAt.getTime()).toBe(NOW.getTime());
  });

  it("rehydrates a historical Run without recalculating timestamps or status", () => {
    const run = Run.rehydrate({
      id: runId,
      workspaceId,
      agentId,
      status: "RUNNING",
      effectiveBindings: createBindings(),
      input: RUN_INPUT,
      createdAt: NOW,
      updatedAt: LATER,
      idempotencyKey: "idem-1",
    });

    expect(run.status).toBe("RUNNING");
    expect(run.input).toEqual(RUN_INPUT);
    expect(run.createdAt.getTime()).toBe(NOW.getTime());
    expect(run.updatedAt.getTime()).toBe(LATER.getTime());
  });

  it("does not treat rehydration as a state transition", () => {
    const succeeded = Run.rehydrate({
      id: runId,
      workspaceId,
      agentId,
      status: "SUCCEEDED",
      effectiveBindings: createBindings(),
      input: RUN_INPUT,
      createdAt: NOW,
      updatedAt: LATER,
    });

    expect(succeeded.status).toBe("SUCCEEDED");
    expect(() => succeeded.transitionTo("PENDING", LATER_STILL)).toThrow(
      InvalidRunTransitionError,
    );
  });
});

describe("RunAttempt creation vs rehydration", () => {
  it("creates the first attempt in PENDING", () => {
    const attempt = RunAttempt.createFirst({
      id: runAttemptId,
      runId,
      createdAt: NOW,
    });

    expect(attempt.status).toBe("PENDING");
    expect(attempt.sequence).toBe(1);
    expect(attempt.startedAt).toBeUndefined();
    expect(attempt.completedAt).toBeUndefined();
  });

  it("creates a subsequent attempt in PENDING", () => {
    const previous = RunAttempt.rehydrate({
      id: runAttemptId,
      runId,
      sequence: 1,
      status: "FAILED",
      createdAt: NOW,
      startedAt: NOW,
      completedAt: LATER,
    });
    const next = RunAttempt.createSubsequent(previous, {
      id: "run-attempt-2" as typeof runAttemptId,
      createdAt: LATER_STILL,
    });

    expect(next.status).toBe("PENDING");
    expect(next.sequence).toBe(2);
    expect(next.startedAt).toBeUndefined();
    expect(next.completedAt).toBeUndefined();
    expect(next.createdAt.getTime()).toBe(LATER_STILL.getTime());
  });

  it("rehydrates a historical attempt without recalculating timestamps", () => {
    const attempt = RunAttempt.rehydrate({
      id: runAttemptId,
      runId,
      sequence: 2,
      status: "TIMED_OUT",
      createdAt: NOW,
      startedAt: LATER,
      completedAt: LATER_STILL,
      error: { code: "TIMEOUT", message: "timed out" },
    });

    expect(attempt.status).toBe("TIMED_OUT");
    expect(attempt.sequence).toBe(2);
    expect(attempt.createdAt.getTime()).toBe(NOW.getTime());
    expect(attempt.startedAt?.getTime()).toBe(LATER.getTime());
    expect(attempt.completedAt?.getTime()).toBe(LATER_STILL.getTime());
    expect(attempt.error).toEqual({
      code: "TIMEOUT",
      message: "timed out",
    });
  });

  it("sets startedAt on PENDING → RUNNING and completedAt on RUNNING → terminal", () => {
    const pending = RunAttempt.createFirst({
      id: runAttemptId,
      runId,
      createdAt: NOW,
    });
    const running = pending.transitionTo("RUNNING", LATER);
    const failed = running.transitionTo("FAILED", LATER_STILL);

    expect(running.startedAt?.getTime()).toBe(LATER.getTime());
    expect(running.completedAt).toBeUndefined();
    expect(failed.startedAt?.getTime()).toBe(LATER.getTime());
    expect(failed.completedAt?.getTime()).toBe(LATER_STILL.getTime());
    expect(failed.createdAt.getTime()).toBe(NOW.getTime());
  });
});
