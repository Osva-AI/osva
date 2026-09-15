import { RUN_STATES, type RunState } from "@osva/contracts";
import { describe, expect, it } from "vitest";

import { InvalidRunTransitionError } from "../src/errors.js";
import { Run } from "../src/run.js";
import {
  isLegalRunTransition,
  isTerminalRunState,
  LEGAL_RUN_TRANSITIONS,
} from "../src/run-state-machine.js";
import {
  agentId,
  createBindings,
  LATER,
  NOW,
  RUN_INPUT,
  runId,
  workspaceId,
} from "./fixtures.js";

const LEGAL_TRANSITION_KEYS = new Set(
  LEGAL_RUN_TRANSITIONS.map(([from, to]) => `${from}->${to}`),
);

function runInState(status: RunState): Run {
  return Run.rehydrate({
    id: runId,
    workspaceId,
    agentId,
    status,
    effectiveBindings: createBindings(),
    input: RUN_INPUT,
    createdAt: NOW,
    updatedAt: NOW,
    idempotencyKey: "idem-1",
  });
}

describe("Run state machine", () => {
  it.each(RUN_STATES.flatMap((from) => RUN_STATES.map((to) => ({ from, to }))))(
    "$from → $to",
    ({ from, to }) => {
      const allowed = LEGAL_TRANSITION_KEYS.has(`${from}->${to}`);
      const run = runInState(from);

      expect(isLegalRunTransition(from, to)).toBe(allowed);
      expect("setStatus" in run).toBe(false);

      if (allowed) {
        const next = run.transitionTo(to, LATER);
        expect(next.status).toBe(to);
        expect(next.id).toBe(run.id);
        expect(next.createdAt.getTime()).toBe(NOW.getTime());
        expect(next.updatedAt.getTime()).toBe(LATER.getTime());
        expect(run.status).toBe(from);
        expect(run.updatedAt.getTime()).toBe(NOW.getTime());
      } else {
        expect(() => run.transitionTo(to, LATER)).toThrow(
          InvalidRunTransitionError,
        );

        try {
          run.transitionTo(to, LATER);
        } catch (error) {
          expect(error).toMatchObject({ from, to });
        }

        expect(run.status).toBe(from);
      }
    },
  );

  it("enumerates exactly the documented legal transitions", () => {
    expect(LEGAL_RUN_TRANSITIONS).toEqual([
      ["PENDING", "QUEUED"],
      ["QUEUED", "RUNNING"],
      ["RUNNING", "SUCCEEDED"],
      ["PENDING", "FAILED"],
      ["QUEUED", "CANCELLED"],
      ["RUNNING", "FAILED"],
      ["RUNNING", "TIMED_OUT"],
      ["RUNNING", "CANCELLED"],
    ]);
  });

  it("preserves createdAt and updates updatedAt on transition", () => {
    const run = Run.create({
      id: runId,
      workspaceId,
      agentId,
      effectiveBindings: createBindings(),
      input: RUN_INPUT,
      createdAt: NOW,
    });
    const queued = run.transitionTo("QUEUED", LATER);

    expect(queued).not.toBe(run);
    expect(queued.createdAt.getTime()).toBe(NOW.getTime());
    expect(queued.updatedAt.getTime()).toBe(LATER.getTime());
    expect(run.createdAt.getTime()).toBe(NOW.getTime());
    expect(run.updatedAt.getTime()).toBe(NOW.getTime());
    expect(queued.input).toEqual(RUN_INPUT);
  });
});

describe("terminal Runs cannot reopen", () => {
  it.each(RUN_STATES.filter(isTerminalRunState))(
    "%s cannot transition to any state",
    (terminal) => {
      const run = runInState(terminal);

      for (const target of RUN_STATES) {
        expect(() => run.transitionTo(target, LATER)).toThrow(
          InvalidRunTransitionError,
        );
        expect(run.status).toBe(terminal);
      }
    },
  );
});
