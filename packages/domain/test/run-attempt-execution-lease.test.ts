import { describe, expect, it } from "vitest";

import { DomainInvariantError } from "../src/errors.js";
import { RunAttempt } from "../src/run-attempt.js";
import { LATER, NOW, runAttemptId, runId } from "./fixtures.js";

describe("RunAttempt execution lease", () => {
  it("attaches a lease only to RUNNING attempts", () => {
    const pending = RunAttempt.createFirst({
      id: runAttemptId,
      runId,
      createdAt: NOW,
    });
    expect(() =>
      pending.withExecutionLease({
        owner: "worker-1",
        generation: 1,
        expiresAt: LATER,
      }),
    ).toThrow(DomainInvariantError);

    const running = pending.transitionTo("RUNNING", LATER).withExecutionLease({
      owner: "worker-1",
      generation: 1,
      expiresAt: new Date(LATER.getTime() + 30_000),
    });
    expect(running.executionOwner).toBe("worker-1");
    expect(running.executionGeneration).toBe(1);
    expect(running.hasActiveExecutionLease(LATER)).toBe(true);
    expect(
      running.hasActiveExecutionLease(new Date(LATER.getTime() + 30_000)),
    ).toBe(false);
  });

  it("clears the lease on terminal transition", () => {
    const failed = RunAttempt.createFirst({
      id: runAttemptId,
      runId,
      createdAt: NOW,
    })
      .transitionTo("RUNNING", LATER)
      .withExecutionLease({
        owner: "worker-1",
        generation: 1,
        expiresAt: new Date(LATER.getTime() + 30_000),
      })
      .transitionTo("FAILED", LATER, {
        error: { code: "EXECUTION_INTERRUPTED", message: "lease expired" },
      });

    expect(failed.status).toBe("FAILED");
    expect(failed.leaseExpiresAt).toBeUndefined();
    expect(failed.executionOwner).toBe("worker-1");
    expect(failed.hasActiveExecutionLease(LATER)).toBe(false);
  });
});
