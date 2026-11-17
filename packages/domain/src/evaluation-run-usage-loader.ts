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
  const judgeAccounting = mergeJudgeUsageFromCaseResults(reconciledCaseResults);
  const durationMs = computeEvaluationRunDurationMs(evaluationRun);

  return {
    inputTokens: merged.inputTokens + judgeAccounting.inputTokens,
    outputTokens: merged.outputTokens + judgeAccounting.outputTokens,
    pricedCostUsdMicros:
      merged.pricedCostUsdMicros + judgeAccounting.pricedCostUsdMicros,
    unpricedModelCalls:
      merged.unpricedModelCalls + judgeAccounting.unpricedModelCalls,
    usageMeasured: true,
    ...(durationMs === undefined ? {} : { durationMs }),
  };
}

function mergeJudgeUsageFromCaseResults(
  caseResults: readonly EvaluationCaseResult[],
): {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly pricedCostUsdMicros: number;
  readonly unpricedModelCalls: number;
  readonly usageMeasured: boolean;
} {
  let inputTokens = 0;
  let outputTokens = 0;
  let pricedCostUsdMicros = 0;
  let unpricedModelCalls = 0;
  let usageMeasured = false;

  for (const result of caseResults) {
    const accounting = result.evaluatorResults.judgeUsageAccounting;
    if (
      accounting !== undefined &&
      typeof accounting === "object" &&
      accounting !== null
    ) {
      const record = accounting as Readonly<Record<string, unknown>>;
      if (typeof record.inputTokens === "number") {
        inputTokens += record.inputTokens;
      }
      if (typeof record.outputTokens === "number") {
        outputTokens += record.outputTokens;
      }
      if (typeof record.pricedCostUsdMicros === "number") {
        pricedCostUsdMicros += record.pricedCostUsdMicros;
      }
      if (typeof record.unpricedModelCalls === "number") {
        unpricedModelCalls += record.unpricedModelCalls;
      }
      if (record.usageMeasured === true) {
        usageMeasured = true;
      }
      continue;
    }

    const attempts = result.evaluatorResults.judgeInvocationAttempts;
    if (!Array.isArray(attempts)) {
      continue;
    }
    for (const attempt of attempts) {
      if (typeof attempt !== "object" || attempt === null) {
        continue;
      }
      const row = attempt as Readonly<Record<string, unknown>>;
      if (typeof row.inputTokens === "number") {
        inputTokens += row.inputTokens;
      }
      if (typeof row.outputTokens === "number") {
        outputTokens += row.outputTokens;
      }
      if (typeof row.pricedCostUsdMicros === "number") {
        pricedCostUsdMicros += row.pricedCostUsdMicros;
      }
      if (typeof row.unpricedModelCalls === "number") {
        unpricedModelCalls += row.unpricedModelCalls;
      }
    }
  }

  return {
    inputTokens,
    outputTokens,
    pricedCostUsdMicros,
    unpricedModelCalls,
    usageMeasured,
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
