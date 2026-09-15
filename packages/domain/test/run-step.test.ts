import type { RunAttemptId, RunId } from "@osva/contracts";
import { describe, expect, it } from "vitest";

import { DomainInvariantError } from "../src/errors.js";
import { RunStep } from "../src/run-step.js";
import { LATER, NOW, runAttemptId, runId, runStepId } from "./fixtures.js";

describe("RunStep identity", () => {
  it("always retains both runId and runAttemptId", () => {
    const step = RunStep.create({
      id: runStepId,
      runId,
      runAttemptId,
      type: "model.generate",
      name: "generate",
      startedAt: NOW,
      completedAt: LATER,
      metadata: { tokenCount: 12 },
    });

    expect(step.runId).toBe(runId);
    expect(step.runAttemptId).toBe(runAttemptId);
    expect(step.id).toBe(runStepId);
    expect(Object.isFrozen(step)).toBe(true);
  });

  it("rejects construction without a parent Run identity", () => {
    expect(() =>
      RunStep.create({
        id: runStepId,
        runId: "" as RunId,
        runAttemptId,
        type: "tool.call",
        name: "search",
        startedAt: NOW,
      }),
    ).toThrow(DomainInvariantError);
  });

  it("rejects construction without a parent RunAttempt identity", () => {
    expect(() =>
      RunStep.create({
        id: runStepId,
        runId,
        runAttemptId: "" as RunAttemptId,
        type: "tool.call",
        name: "search",
        startedAt: NOW,
      }),
    ).toThrow(DomainInvariantError);
  });
});
