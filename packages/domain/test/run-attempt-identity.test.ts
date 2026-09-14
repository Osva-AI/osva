import type { RunAttemptId } from "@osva/contracts";
import { describe, expect, it } from "vitest";

import {
  DomainInvariantError,
  InvalidAttemptSequenceError,
  InvalidSubsequentAttemptError,
} from "../src/errors.js";
import { RunAttempt } from "../src/run-attempt.js";
import { LATER, LATER_STILL, NOW, runAttemptId, runId } from "./fixtures.js";

const secondAttemptId = "run-attempt-2" as RunAttemptId;
const thirdAttemptId = "run-attempt-3" as RunAttemptId;

function retryableAttempt(
  status: "FAILED" | "TIMED_OUT" | "CANCELLED",
): RunAttempt {
  return RunAttempt.rehydrate({
    id: runAttemptId,
    runId,
    sequence: 1,
    status,
    createdAt: NOW,
    startedAt: status === "CANCELLED" ? undefined : NOW,
    completedAt: LATER,
  });
}

describe("RunAttempt identity and sequencing", () => {
  it("creates the first logical attempt with sequence 1 and PENDING status", () => {
    const attempt = RunAttempt.createFirst({
      id: runAttemptId,
      runId,
      createdAt: NOW,
    });

    expect(attempt.sequence).toBe(1);
    expect(attempt.status).toBe("PENDING");
    expect(attempt.id).toBe(runAttemptId);
    expect(attempt.runId).toBe(runId);
    expect(attempt.startedAt).toBeUndefined();
    expect(attempt.completedAt).toBeUndefined();
  });

  it.each([0, -1, 1.5, Number.NaN])(
    "rejects non-positive or non-integer sequence %s on rehydrate",
    (sequence) => {
      expect(() =>
        RunAttempt.rehydrate({
          id: runAttemptId,
          runId,
          sequence,
          status: "PENDING",
          createdAt: NOW,
        }),
      ).toThrow(InvalidAttemptSequenceError);
    },
  );

  it("requires a subsequent attempt sequence to follow the previous attempt", () => {
    const firstFailed = retryableAttempt("FAILED");
    const second = RunAttempt.createSubsequent(firstFailed, {
      id: secondAttemptId,
      createdAt: LATER_STILL,
    });
    const secondFailed = second
      .transitionTo("RUNNING", LATER_STILL)
      .transitionTo("FAILED", LATER_STILL);
    const third = RunAttempt.createSubsequent(secondFailed, {
      id: thirdAttemptId,
      createdAt: LATER_STILL,
    });

    expect(second.id).toBe(secondAttemptId);
    expect(second.runId).toBe(runId);
    expect(second.sequence).toBe(2);
    expect(second.status).toBe("PENDING");
    expect(third.sequence).toBe(3);
    expect(third.id).toBe(thirdAttemptId);
    expect(third.status).toBe("PENDING");
  });

  it("rejects allocating another attempt with the same RunAttemptId", () => {
    const previous = retryableAttempt("FAILED");

    expect(() =>
      RunAttempt.createSubsequent(previous, {
        id: previous.id,
        createdAt: LATER_STILL,
      }),
    ).toThrow(DomainInvariantError);
  });

  it("reuses an existing RunAttempt on queue redelivery without allocating another", () => {
    const pending = RunAttempt.createFirst({
      id: runAttemptId,
      runId,
      createdAt: NOW,
      infrastructureMetadata: { deliveryId: "delivery-1" },
    });

    const redelivered = pending.transitionTo("RUNNING", LATER, {
      infrastructureMetadata: { deliveryId: "delivery-1", redelivery: true },
    });

    expect(redelivered.id).toBe(pending.id);
    expect(redelivered.sequence).toBe(1);
    expect(redelivered.runId).toBe(pending.runId);
    expect(redelivered.status).toBe("RUNNING");
    expect(redelivered.startedAt?.getTime()).toBe(LATER.getTime());
    expect(pending.status).toBe("PENDING");
  });
});

describe("subsequent attempt eligibility", () => {
  it.each(["PENDING", "RUNNING"] as const)(
    "rejects a new attempt when the previous attempt is %s",
    (status) => {
      const previous = RunAttempt.rehydrate({
        id: runAttemptId,
        runId,
        sequence: 1,
        status,
        createdAt: NOW,
        startedAt: status === "RUNNING" ? NOW : undefined,
      });

      expect(() =>
        RunAttempt.createSubsequent(previous, {
          id: secondAttemptId,
          createdAt: LATER,
        }),
      ).toThrow(InvalidSubsequentAttemptError);

      try {
        RunAttempt.createSubsequent(previous, {
          id: secondAttemptId,
          createdAt: LATER,
        });
      } catch (error) {
        expect(error).toMatchObject({ previousStatus: status });
      }
    },
  );

  it.each(["FAILED", "TIMED_OUT", "CANCELLED"] as const)(
    "permits a new attempt after %s",
    (status) => {
      const previous = retryableAttempt(status);
      const next = RunAttempt.createSubsequent(previous, {
        id: secondAttemptId,
        createdAt: LATER_STILL,
      });

      expect(next.status).toBe("PENDING");
      expect(next.sequence).toBe(2);
      expect(next.id).toBe(secondAttemptId);
      expect(next.id).not.toBe(previous.id);
    },
  );

  it("rejects a new attempt after SUCCEEDED", () => {
    const previous = RunAttempt.rehydrate({
      id: runAttemptId,
      runId,
      sequence: 1,
      status: "SUCCEEDED",
      createdAt: NOW,
      startedAt: NOW,
      completedAt: LATER,
    });

    expect(() =>
      RunAttempt.createSubsequent(previous, {
        id: secondAttemptId,
        createdAt: LATER_STILL,
      }),
    ).toThrow(InvalidSubsequentAttemptError);

    try {
      RunAttempt.createSubsequent(previous, {
        id: secondAttemptId,
        createdAt: LATER_STILL,
      });
    } catch (error) {
      expect(error).toMatchObject({ previousStatus: "SUCCEEDED" });
    }
  });
});
