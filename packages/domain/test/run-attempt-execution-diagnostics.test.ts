import { describe, expect, it } from "vitest";

import { RunAttempt } from "../src/run-attempt.js";
import { toRunAttemptExecutionDiagnostics } from "../src/run-attempt-execution-diagnostics.js";
import { LATER, NOW, runAttemptId, runId } from "./fixtures.js";

describe("RunAttempt execution diagnostics", () => {
  it("describes a queued first attempt without a lease", () => {
    const attempt = RunAttempt.createFirst({
      id: runAttemptId,
      runId,
      createdAt: NOW,
    });
    const diagnostics = toRunAttemptExecutionDiagnostics(attempt, LATER);
    expect(diagnostics).toMatchObject({
      state: "queued",
      leased: false,
      interrupted: false,
      executionGeneration: 0,
    });
    expect(diagnostics).not.toHaveProperty("executionOwner");
  });

  it("describes a leased running attempt using the supplied observation clock", () => {
    const expiresAt = new Date(LATER.getTime() + 30_000);
    const attempt = RunAttempt.createFirst({
      id: runAttemptId,
      runId,
      createdAt: NOW,
    })
      .transitionTo("RUNNING", LATER)
      .withExecutionLease({
        owner: "worker-secret",
        generation: 2,
        expiresAt,
      });
    const active = toRunAttemptExecutionDiagnostics(attempt, LATER);
    expect(active.state).toBe("running_leased");
    expect(active.leased).toBe(true);
    expect(active.executionGeneration).toBe(2);
    expect(active.leaseExpiresAt).toBe(expiresAt.toISOString());
    expect(JSON.stringify(active)).not.toContain("worker-secret");

    const expired = toRunAttemptExecutionDiagnostics(
      attempt,
      new Date(expiresAt.getTime() + 1),
    );
    expect(expired.state).toBe("running_lease_expired");
    expect(expired.leased).toBe(true);
  });

  it("describes a legacy unleased running attempt without inferring expiry", () => {
    const attempt = RunAttempt.createFirst({
      id: runAttemptId,
      runId,
      createdAt: NOW,
    }).transitionTo("RUNNING", LATER);
    const diagnostics = toRunAttemptExecutionDiagnostics(attempt, LATER);
    expect(diagnostics.state).toBe("running_unleased");
    expect(diagnostics.leased).toBe(false);
  });

  it("marks EXECUTION_INTERRUPTED attempts as interrupted with an allowlisted reason", () => {
    const attempt = RunAttempt.rehydrate({
      id: runAttemptId,
      runId,
      sequence: 1,
      status: "FAILED",
      createdAt: NOW,
      startedAt: LATER,
      completedAt: LATER,
      error: {
        code: "EXECUTION_INTERRUPTED",
        message: "Execution lease expired; worker ownership was lost.",
      },
      executionOwner: "worker-secret",
      executionGeneration: 1,
      infrastructureMetadata: {
        recovery: {
          reason: "LEASE_EXPIRED",
          owner: "worker-secret",
        },
      },
    });
    const diagnostics = toRunAttemptExecutionDiagnostics(attempt, LATER);
    expect(diagnostics.state).toBe("interrupted");
    expect(diagnostics.interrupted).toBe(true);
    expect(diagnostics.recoveryReason).toBe("LEASE_EXPIRED");
    expect(JSON.stringify(diagnostics)).not.toContain("worker-secret");
  });

  it("does not treat a successful completion as a retry or interruption", () => {
    const attempt = RunAttempt.createFirst({
      id: runAttemptId,
      runId,
      createdAt: NOW,
    })
      .transitionTo("RUNNING", LATER)
      .transitionTo("SUCCEEDED", LATER, { output: { ok: true } });
    const diagnostics = toRunAttemptExecutionDiagnostics(attempt, LATER);
    expect(diagnostics.state).toBe("completed");
    expect(diagnostics.interrupted).toBe(false);
    expect(diagnostics.recoveryReason).toBeUndefined();
  });
});
