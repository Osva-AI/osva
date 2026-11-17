import { EXECUTION_INTERRUPTED_ERROR_CODE } from "@osva-ai/contracts";
import type {
  EvaluationCaseId,
  EvaluationRunId,
  RunAttemptId,
  RunId,
  WorkspaceId,
} from "@osva-ai/contracts";
import { describe, expect, it } from "vitest";

import { EffectiveRunBindings } from "../src/effective-run-bindings.js";
import { Run } from "../src/run.js";
import { RunAttempt } from "../src/run-attempt.js";
import { shouldFinalizeEvaluationCaseResult } from "../src/evaluation-run-case-finalization.js";

const NOW = new Date("2026-01-01T00:00:00.000Z");

function evaluationChildRun(status: Run["status"]): Run {
  return Run.rehydrate({
    id: "run-child" as RunId,
    workspaceId: "ws-1" as WorkspaceId,
    agentId: "agent-1" as import("@osva-ai/contracts").AgentId,
    status,
    effectiveBindings: EffectiveRunBindings.create({
      agentVersionId: "agv-1" as import("@osva-ai/contracts").AgentVersionId,
      modelProfileVersionBindings: {},
      toolVersionBindings: {},
      memoryNamespaceBindings: {},
      knowledgeIndexBindings: {},
    }),
    input: "answer",
    createdAt: NOW,
    updatedAt: NOW,
    evaluationRunId: "er-1" as EvaluationRunId,
    evaluationCaseId: "ec-1" as EvaluationCaseId,
  });
}

describe("shouldFinalizeEvaluationCaseResult", () => {
  it("finalizes succeeded attempts immediately", () => {
    const run = evaluationChildRun("SUCCEEDED");
    const attempt = RunAttempt.rehydrate({
      id: "ra-1" as RunAttemptId,
      runId: run.id,
      sequence: 1,
      status: "SUCCEEDED",
      createdAt: NOW,
      output: "ok",
    });
    expect(shouldFinalizeEvaluationCaseResult(run, attempt)).toBe(true);
  });

  it("defers interrupted child failure while run recovery is pending", () => {
    const run = evaluationChildRun("INTERRUPTED");
    const attempt = RunAttempt.rehydrate({
      id: "ra-1" as RunAttemptId,
      runId: run.id,
      sequence: 1,
      status: "FAILED",
      createdAt: NOW,
      error: {
        code: EXECUTION_INTERRUPTED_ERROR_CODE,
        message: "lease expired",
      },
    });
    expect(shouldFinalizeEvaluationCaseResult(run, attempt)).toBe(false);
  });

  it("finalizes durable child failure when run is terminal", () => {
    const run = evaluationChildRun("FAILED");
    const attempt = RunAttempt.rehydrate({
      id: "ra-1" as RunAttemptId,
      runId: run.id,
      sequence: 1,
      status: "FAILED",
      createdAt: NOW,
      error: { code: "RUNTIME_ERROR", message: "boom" },
    });
    expect(shouldFinalizeEvaluationCaseResult(run, attempt)).toBe(true);
  });
});
