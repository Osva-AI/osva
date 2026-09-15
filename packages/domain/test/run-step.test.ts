import type { RunAttemptId, RunId } from "@osva/contracts";
import { describe, expect, it } from "vitest";

import { DomainInvariantError } from "../src/errors.js";
import { RunStep } from "../src/run-step.js";
import {
  LATER,
  NOW,
  modelProfileVersionId,
  runAttemptId,
  runId,
  runStepId,
} from "./fixtures.js";

describe("RunStep identity", () => {
  it("always retains both runId and runAttemptId", () => {
    const step = RunStep.create({
      id: runStepId,
      runId,
      runAttemptId,
      kind: "MODEL",
      bindingName: "default",
      status: "SUCCEEDED",
      startedAt: NOW,
      completedAt: LATER,
      modelProfileVersionId,
      inputTokens: 12,
      outputTokens: 4,
      totalTokens: 16,
    });

    expect(step.runId).toBe(runId);
    expect(step.runAttemptId).toBe(runAttemptId);
    expect(step.id).toBe(runStepId);
    expect(Object.isFrozen(step)).toBe(true);
  });

  it("rejects construction without a parent Run identity", () => {
    expect(() =>
      RunStep.start({
        id: runStepId,
        runId: "" as RunId,
        runAttemptId,
        kind: "TOOL",
        bindingName: "echo",
        startedAt: NOW,
        toolVersionId:
          "tool-version-1" as import("@osva/contracts").ToolVersionId,
      }),
    ).toThrow(DomainInvariantError);
  });

  it("rejects construction without a parent RunAttempt identity", () => {
    expect(() =>
      RunStep.start({
        id: runStepId,
        runId,
        runAttemptId: "" as RunAttemptId,
        kind: "MODEL",
        bindingName: "default",
        startedAt: NOW,
        modelProfileVersionId,
      }),
    ).toThrow(DomainInvariantError);
  });

  it("finalizes a running step without rewriting identity", () => {
    const running = RunStep.start({
      id: runStepId,
      runId,
      runAttemptId,
      kind: "MODEL",
      bindingName: "default",
      startedAt: NOW,
      modelProfileVersionId,
    });

    const finalized = running.finalize({
      status: "SUCCEEDED",
      completedAt: LATER,
      inputTokens: 10,
      outputTokens: 5,
      totalTokens: 15,
      estimatedCostUsdMicros: 42,
    });

    expect(finalized.status).toBe("SUCCEEDED");
    expect(finalized.bindingName).toBe("default");
    expect(finalized.estimatedCostUsdMicros).toBe(42);
  });
});
