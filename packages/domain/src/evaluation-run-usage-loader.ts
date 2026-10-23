import type { RunId, WorkspaceId } from "@osva-ai/contracts";

import type { EvaluationCaseResult } from "./evaluation-case-result.js";
import type { EvaluationRun } from "./evaluation-run.js";
import { RunNotFoundError } from "./errors.js";
import {
  assertChildRunsHaveAttempts,
  collectRunAttemptIdsForUsageAccounting,
  computeEvaluationRunDurationMs,
  mergeRunAttemptUsageSummaries,
  UNMEASURED_EVALUATION_RUN_USAGE,
  type EvaluationRunUsageMeasurement,
} from "./evaluation-run-usage.js";
import type { RunRepository } from "./ports/run-repository.js";

export async function loadEvaluationRunUsageMeasurement(
  runs: RunRepository,
  workspaceId: WorkspaceId,
  evaluationRun: EvaluationRun,
  reconciledCaseResults: readonly EvaluationCaseResult[],
): Promise<EvaluationRunUsageMeasurement> {
  if (reconciledCaseResults.length === 0) {
    return UNMEASURED_EVALUATION_RUN_USAGE;
  }

  for (const result of reconciledCaseResults) {
    const run = await runs.findRunByWorkspaceAndId(workspaceId, result.runId);
    if (run === null) {
      throw new RunNotFoundError(result.runId);
    }
  }

  const runIds = uniqueRunIds(reconciledCaseResults);
  const attempts = await runs.listRunAttemptsForRuns(runIds);
  assertChildRunsHaveAttempts(attempts, runIds);

  const runAttemptIds = collectRunAttemptIdsForUsageAccounting(
    attempts,
    runIds,
  );

  const usageSummary = await runs.aggregateRunAttemptUsageBatch(runAttemptIds);
  const merged = mergeRunAttemptUsageSummaries([usageSummary]);
  const durationMs = computeEvaluationRunDurationMs(evaluationRun);

  return {
    ...merged,
    usageMeasured: true,
    ...(durationMs === undefined ? {} : { durationMs }),
  };
}

function uniqueRunIds(
  caseResults: readonly EvaluationCaseResult[],
): readonly RunId[] {
  const seen = new Set<RunId>();
  const ordered: RunId[] = [];
  for (const result of caseResults) {
    if (seen.has(result.runId)) {
      continue;
    }
    seen.add(result.runId);
    ordered.push(result.runId);
  }
  return ordered;
}
