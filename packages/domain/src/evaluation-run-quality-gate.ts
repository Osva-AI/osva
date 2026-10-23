import type {
  EvaluationQualityGateAssessmentV1,
  EvaluationRunQualityGateV1,
  WorkspaceId,
} from "@osva-ai/contracts";

import { assessEvaluationQualityGate } from "./evaluation-quality-gate-assessment.js";
import type { EvaluationRunApplicationDependencies } from "./evaluation-run-application.js";
import { EvaluationGateAssessmentConflictError } from "./errors.js";
import { EvaluationRunGateAssessment } from "./evaluation-run-gate-assessment.js";
import type { EvaluationRun } from "./evaluation-run.js";
import {
  aggregateEvaluationRunSummary,
  reconcileCaseResultsForScoring,
  type EvaluationRunSummary,
} from "./evaluation-run-scoring.js";
import { TERMINAL_EVALUATION_RUN_STATES } from "./evaluation-run-state-machine.js";
import { loadEvaluationRunUsageMeasurement } from "./evaluation-run-usage-loader.js";

function isTerminalEvaluationRunStatus(
  status: EvaluationRun["status"],
): boolean {
  return (TERMINAL_EVALUATION_RUN_STATES as readonly string[]).includes(status);
}

export function allowFinalQualityGatePass(
  evaluationRun: EvaluationRun,
): boolean {
  return evaluationRun.status === "COMPLETED";
}

export function suppressUnpersistedQualityGatePass(
  assessment: EvaluationQualityGateAssessmentV1,
  persisted: boolean,
): EvaluationQualityGateAssessmentV1 {
  if (persisted || assessment.overallVerdict !== "PASS") {
    return assessment;
  }
  return {
    ...assessment,
    overallVerdict: "INDETERMINATE",
  };
}

export async function buildEvaluationRunSummaryForRun(
  deps: EvaluationRunApplicationDependencies,
  workspaceId: WorkspaceId,
  evaluationRun: EvaluationRun,
  totalCases: number,
): Promise<EvaluationRunSummary> {
  const caseResults =
    await deps.evaluationSuites.listCaseResultsByEvaluationRun(
      evaluationRun.id,
    );
  const reconciled = reconcileCaseResultsForScoring(caseResults);
  const usage = await loadEvaluationRunUsageMeasurement(
    deps.runs,
    workspaceId,
    evaluationRun,
    reconciled,
  );
  return aggregateEvaluationRunSummary(totalCases, caseResults, usage);
}

export async function persistTerminalEvaluationRunGateAssessment(
  deps: EvaluationRunApplicationDependencies,
  evaluationRun: EvaluationRun,
  summary: EvaluationRunSummary,
  assessedAt: Date,
): Promise<void> {
  const policy = evaluationRun.qualityGatePolicy;
  if (
    policy === undefined ||
    !isTerminalEvaluationRunStatus(evaluationRun.status)
  ) {
    return;
  }

  const assessment = assessEvaluationQualityGate({
    policy,
    evaluationRunStatus: evaluationRun.status,
    summary,
    assessedAt,
    allowFinalPass: allowFinalQualityGatePass(evaluationRun),
  });

  await deps.evaluationSuites.saveGateAssessment(
    EvaluationRunGateAssessment.create({
      evaluationRunId: evaluationRun.id,
      workspaceId: evaluationRun.workspaceId,
      policySnapshot: policy,
      assessment,
    }),
  );
}

export async function resolveEvaluationRunQualityGate(
  deps: EvaluationRunApplicationDependencies,
  evaluationRun: EvaluationRun,
  summary: EvaluationRunSummary,
  now: Date,
): Promise<EvaluationRunQualityGateV1 | undefined> {
  const policy = evaluationRun.qualityGatePolicy;
  if (policy === undefined) {
    return undefined;
  }

  const persisted =
    await deps.evaluationSuites.findGateAssessmentByWorkspaceAndEvaluationRunId(
      evaluationRun.workspaceId,
      evaluationRun.id,
    );
  if (persisted !== null) {
    return {
      policy: persisted.policySnapshot,
      assessment: persisted.assessment,
    };
  }

  if (isTerminalEvaluationRunStatus(evaluationRun.status)) {
    try {
      await persistTerminalEvaluationRunGateAssessment(
        deps,
        evaluationRun,
        summary,
        now,
      );
      const stored =
        await deps.evaluationSuites.findGateAssessmentByWorkspaceAndEvaluationRunId(
          evaluationRun.workspaceId,
          evaluationRun.id,
        );
      if (stored !== null) {
        return {
          policy: stored.policySnapshot,
          assessment: stored.assessment,
        };
      }
    } catch (error) {
      if (error instanceof EvaluationGateAssessmentConflictError) {
        throw error;
      }
      // Transient persist failure: fall through to preview without silent PASS.
    }
  }

  const preview = assessEvaluationQualityGate({
    policy,
    evaluationRunStatus: evaluationRun.status,
    summary,
    assessedAt: now,
    allowFinalPass: false,
  });

  return {
    policy,
    assessment: suppressUnpersistedQualityGatePass(preview, false),
  };
}
