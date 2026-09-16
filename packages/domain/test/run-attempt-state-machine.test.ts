import { RUN_ATTEMPT_STATES, type RunAttemptState } from "@osva/contracts";
import { describe, expect, it } from "vitest";

import { InvalidRunAttemptTransitionError } from "../src/errors.js";
import { RunAttempt } from "../src/run-attempt.js";
import {
  isLegalRunAttemptTransition,
  isTerminalRunAttemptState,
  LEGAL_RUN_ATTEMPT_TRANSITIONS,
} from "../src/run-attempt-state-machine.js";
import { LATER, NOW, runAttemptId, runId } from "./fixtures.js";

const LEGAL_TRANSITION_KEYS = new Set(
  LEGAL_RUN_ATTEMPT_TRANSITIONS.map(([from, to]) => `${from}->${to}`),
);

function attemptInState(status: RunAttemptState): RunAttempt {
  return RunAttempt.rehydrate({
    id: runAttemptId,
    runId,
    sequence: 1,
    status,
    createdAt: NOW,
    startedAt: status === "PENDING" ? undefined : NOW,
    completedAt: isTerminalRunAttemptState(status) ? NOW : undefined,
  });
}

describe("RunAttempt state machine", () => {
  it.each(
    RUN_ATTEMPT_STATES.flatMap((from) =>
      RUN_ATTEMPT_STATES.map((to) => ({ from, to })),
    ),
  )("$from → $to", ({ from, to }) => {
    const allowed = LEGAL_TRANSITION_KEYS.has(`${from}->${to}`);
    const attempt = attemptInState(from);

    expect(isLegalRunAttemptTransition(from, to)).toBe(allowed);

    if (allowed) {
      const next = attempt.transitionTo(
        to,
        LATER,
        to === "SUCCEEDED" ? { output: { ok: true } } : undefined,
      );
      expect(next.status).toBe(to);
      expect(next.id).toBe(attempt.id);
      expect(next.sequence).toBe(attempt.sequence);
      expect(attempt.status).toBe(from);

      if (from === "PENDING" && to === "RUNNING") {
        expect(next.startedAt?.getTime()).toBe(LATER.getTime());
        expect(next.completedAt).toBeUndefined();
      }

      if (from === "RUNNING" && isTerminalRunAttemptState(to)) {
        expect(next.startedAt?.getTime()).toBe(NOW.getTime());
        expect(next.completedAt?.getTime()).toBe(LATER.getTime());
      }

      if (from === "PENDING" && to === "CANCELLED") {
        expect(next.startedAt).toBeUndefined();
        expect(next.completedAt?.getTime()).toBe(LATER.getTime());
      }
    } else {
      expect(() => attempt.transitionTo(to, LATER)).toThrow(
        InvalidRunAttemptTransitionError,
      );

      try {
        attempt.transitionTo(to, LATER);
      } catch (error) {
        expect(error).toMatchObject({ from, to });
      }

      expect(attempt.status).toBe(from);
    }
  });

  it("does not include QUEUED", () => {
    expect(RUN_ATTEMPT_STATES).not.toContain("QUEUED");
    expect(
      LEGAL_RUN_ATTEMPT_TRANSITIONS.flat().includes("QUEUED" as never),
    ).toBe(false);
  });

  it("enumerates exactly the Stage 0 legal attempt transitions", () => {
    expect(LEGAL_RUN_ATTEMPT_TRANSITIONS).toEqual([
      ["PENDING", "RUNNING"],
      ["RUNNING", "SUCCEEDED"],
      ["RUNNING", "FAILED"],
      ["RUNNING", "TIMED_OUT"],
      ["RUNNING", "CANCELLED"],
      ["PENDING", "CANCELLED"],
    ]);
  });
});

describe("terminal RunAttempts cannot reopen", () => {
  it.each(RUN_ATTEMPT_STATES.filter(isTerminalRunAttemptState))(
    "%s cannot transition to any state",
    (terminal) => {
      const attempt = attemptInState(terminal);

      for (const target of RUN_ATTEMPT_STATES) {
        expect(() => attempt.transitionTo(target, LATER)).toThrow(
          InvalidRunAttemptTransitionError,
        );
        expect(attempt.status).toBe(terminal);
      }
    },
  );
});
