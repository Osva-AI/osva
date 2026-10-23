import type {
  EvaluationRunId,
  EvaluationSuiteVersionId,
  WorkspaceId,
} from "@osva-ai/contracts";
import { EVALUATION_QUALITY_GATE_POLICY_SCHEMA_VERSION } from "@osva-ai/contracts";
import { describe, expect, it } from "vitest";

import { EvaluationGateAssessmentConflictError } from "../src/errors.js";
import { assessEvaluationQualityGate } from "../src/evaluation-quality-gate-assessment.js";
import {
  EvaluationRunGateAssessment,
  isSameEvaluationRunGateAssessment,
} from "../src/evaluation-run-gate-assessment.js";
import type { EvaluationRunApplicationDependencies } from "../src/evaluation-run-application.js";
import { EvaluationRun } from "../src/evaluation-run.js";
import type { EvaluationRunSummary } from "../src/evaluation-run-scoring.js";
import {
  persistTerminalEvaluationRunGateAssessment,
  resolveEvaluationRunQualityGate,
} from "../src/evaluation-run-quality-gate.js";
import type { EvaluationSuiteRepository } from "../src/ports/evaluation-suite-repository.js";

const NOW = new Date("2026-01-01T00:00:00.000Z");

const GATE_POLICY = {
  schemaVersion: EVALUATION_QUALITY_GATE_POLICY_SCHEMA_VERSION,
  rules: [
    { metric: "PASS_RATE" as const, operator: "MIN" as const, threshold: 0 },
  ],
};

const PASSING_SUMMARY: EvaluationRunSummary = {
  totalCases: 1,
  pendingCases: 0,
  runningCases: 0,
  completedCases: 1,
  passedCases: 1,
  failedCases: 0,
  errorCases: 0,
  passRate: 1,
  completionCoverage: 1,
  validScoredCaseCount: 1,
  qualityScore: 1,
  durationMs: 1,
  inputTokens: 0,
  outputTokens: 0,
  pricedCostUsdMicros: 0,
  unpricedModelCalls: 0,
  usageMeasured: true,
};

function completedRun(id: string): EvaluationRun {
  const pending = EvaluationRun.create({
    id: id as EvaluationRunId,
    workspaceId: "ws-gate" as import("@osva-ai/contracts").WorkspaceId,
    evaluationSuiteVersionId: "esv-gate" as EvaluationSuiteVersionId,
    targetType: "AGENT_VERSION",
    targetVersionId: "agv-gate",
    qualityGatePolicy: GATE_POLICY,
    createdAt: NOW,
  });
  const running = pending.transitionTo("RUNNING", {
    updatedAt: NOW,
    startedAt: NOW,
  });
  return running.transitionTo("COMPLETED", {
    updatedAt: NOW,
    completedAt: NOW,
  });
}

function createGateRepository(options?: {
  readonly failSaveOnce?: boolean;
  readonly run?: EvaluationRun;
}): EvaluationSuiteRepository {
  let assessment: EvaluationRunGateAssessment | null = null;
  let failSaveOnce = options?.failSaveOnce ?? false;

  return {
    findGateAssessmentByWorkspaceAndEvaluationRunId: async (
      workspaceId: WorkspaceId,
      evaluationRunId: EvaluationRunId,
    ) => {
      if (
        assessment !== null &&
        assessment.workspaceId === workspaceId &&
        assessment.evaluationRunId === evaluationRunId
      ) {
        return assessment;
      }
      return null;
    },
    findGateAssessmentByEvaluationRunId: async (
      evaluationRunId: EvaluationRunId,
    ) => (assessment?.evaluationRunId === evaluationRunId ? assessment : null),
    saveGateAssessment: async (next: EvaluationRunGateAssessment) => {
      if (failSaveOnce) {
        failSaveOnce = false;
        throw new Error("simulated persistence failure");
      }
      if (assessment !== null) {
        if (isSameEvaluationRunGateAssessment(assessment, next)) {
          return;
        }
        throw new EvaluationGateAssessmentConflictError(next.evaluationRunId);
      }
      assessment = next;
    },
    findEvaluationRunById: async (id: EvaluationRunId) =>
      options?.run !== undefined && options.run.id === id ? options.run : null,
    saveEvaluationRun: async () => {},
  } as unknown as EvaluationSuiteRepository;
}

function createDeps(
  evaluationSuites: EvaluationSuiteRepository,
): EvaluationRunApplicationDependencies {
  return {
    evaluationSuites,
    runs: {} as EvaluationRunApplicationDependencies["runs"],
    agents: {} as EvaluationRunApplicationDependencies["agents"],
    queue: {} as EvaluationRunApplicationDependencies["queue"],
    clock: { now: () => NOW },
    ids: { createId: () => "unused-id" },
  };
}

describe("evaluation run quality gate recovery", () => {
  it("does not report PASS when terminal persistence fails, then repairs on retry", async () => {
    const run = completedRun("eval-run-recover-1");
    const evaluationSuites = createGateRepository({ failSaveOnce: true, run });
    const deps = createDeps(evaluationSuites);

    const first = await resolveEvaluationRunQualityGate(
      deps,
      run,
      PASSING_SUMMARY,
      NOW,
    );
    expect(first?.assessment?.overallVerdict).not.toBe("PASS");

    const second = await resolveEvaluationRunQualityGate(
      deps,
      run,
      PASSING_SUMMARY,
      NOW,
    );
    expect(second?.assessment?.overallVerdict).toBe("PASS");
  });

  it("keeps terminal run status when persistence fails", async () => {
    const run = completedRun("eval-run-recover-2");
    const evaluationSuites = createGateRepository({ failSaveOnce: true, run });
    const deps = createDeps(evaluationSuites);

    await resolveEvaluationRunQualityGate(deps, run, PASSING_SUMMARY, NOW);
    const loaded = await evaluationSuites.findEvaluationRunById(run.id);
    expect(loaded?.status).toBe("COMPLETED");
  });

  it("rejects conflicting stored assessments", async () => {
    const run = completedRun("eval-run-recover-3");
    const evaluationSuites = createGateRepository({ run });
    const deps = createDeps(evaluationSuites);

    const baseline = assessEvaluationQualityGate({
      policy: GATE_POLICY,
      evaluationRunStatus: "COMPLETED",
      summary: PASSING_SUMMARY,
      assessedAt: NOW,
      allowFinalPass: true,
    });
    await evaluationSuites.saveGateAssessment(
      EvaluationRunGateAssessment.create({
        evaluationRunId: run.id,
        workspaceId: run.workspaceId,
        policySnapshot: GATE_POLICY,
        assessment: baseline,
      }),
    );

    await expect(
      persistTerminalEvaluationRunGateAssessment(
        deps,
        run,
        { ...PASSING_SUMMARY, passRate: 0, passedCases: 0, failedCases: 1 },
        NOW,
      ),
    ).rejects.toBeInstanceOf(EvaluationGateAssessmentConflictError);

    const stored = await evaluationSuites.findGateAssessmentByEvaluationRunId(
      run.id,
    );
    expect(stored?.assessment.overallVerdict).toBe(baseline.overallVerdict);
  });

  it("persists idempotently under concurrent terminal recovery", async () => {
    const run = completedRun("eval-run-recover-4");
    const evaluationSuites = createGateRepository({ run });
    const deps = createDeps(evaluationSuites);

    const results = await Promise.all([
      resolveEvaluationRunQualityGate(deps, run, PASSING_SUMMARY, NOW),
      resolveEvaluationRunQualityGate(deps, run, PASSING_SUMMARY, NOW),
    ]);

    expect(results[0]?.assessment?.overallVerdict).toBe("PASS");
    expect(results[1]?.assessment?.overallVerdict).toBe("PASS");
    expect(
      await evaluationSuites.findGateAssessmentByEvaluationRunId(run.id),
    ).not.toBeNull();
  });
});
