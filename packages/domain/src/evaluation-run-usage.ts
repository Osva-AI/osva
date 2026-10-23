import type { RunAttemptId, RunId } from "@osva-ai/contracts";

import { DomainInvariantError } from "./errors.js";
import type { EvaluationRun } from "./evaluation-run.js";
import type { RunAttempt } from "./run-attempt.js";
import { TERMINAL_EVALUATION_RUN_STATES } from "./evaluation-run-state-machine.js";
import type { RunAttemptUsageSummary } from "./ports/run-repository.js";

export interface EvaluationRunUsageMeasurement {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly pricedCostUsdMicros: number;
  readonly unpricedModelCalls: number;
  readonly durationMs?: number;
  readonly usageMeasured: boolean;
}

export const UNMEASURED_EVALUATION_RUN_USAGE: EvaluationRunUsageMeasurement = {
  inputTokens: 0,
  outputTokens: 0,
  pricedCostUsdMicros: 0,
  unpricedModelCalls: 0,
  usageMeasured: false,
};

export function isMeasurableModelRunStep(step: {
  readonly kind: string;
  readonly status: string;
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly estimatedCostUsdMicros?: number | null;
}): boolean {
  if (step.kind !== "MODEL") {
    return false;
  }
  if (step.status === "SUCCEEDED") {
    return true;
  }
  if (step.status === "FAILED") {
    return (
      (step.inputTokens ?? 0) > 0 ||
      (step.outputTokens ?? 0) > 0 ||
      (step.estimatedCostUsdMicros !== null &&
        step.estimatedCostUsdMicros !== undefined)
    );
  }
  return false;
}

export function emptyRunAttemptUsageSummary(): RunAttemptUsageSummary {
  return {
    modelCalls: 0,
    toolCalls: 0,
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    cachedInputTokens: 0,
    estimatedCostUsdMicros: null,
    pricedModelCalls: 0,
    unpricedModelCalls: 0,
  };
}

/**
 * Collects every RunAttempt id for aggregate resource accounting on child Runs.
 * Logical retries create new RunAttemptIds; queue redelivery reuses one id and
 * does not duplicate ids here.
 */
export function collectRunAttemptIdsForUsageAccounting(
  attempts: readonly RunAttempt[],
  runIds: readonly RunId[],
): readonly RunAttemptId[] {
  const runIdSet = new Set(runIds);
  const seen = new Set<RunAttemptId>();
  const selected: RunAttempt[] = [];

  for (const attempt of attempts) {
    if (!runIdSet.has(attempt.runId) || seen.has(attempt.id)) {
      continue;
    }
    seen.add(attempt.id);
    selected.push(attempt);
  }

  selected.sort(
    (left, right) =>
      left.runId.localeCompare(right.runId) || left.sequence - right.sequence,
  );

  return selected.map((attempt) => attempt.id);
}

export function assertChildRunsHaveAttempts(
  attempts: readonly RunAttempt[],
  runIds: readonly RunId[],
): void {
  for (const runId of runIds) {
    if (!attempts.some((attempt) => attempt.runId === runId)) {
      throw new DomainInvariantError(
        `Evaluation child Run '${runId}' has no RunAttempts for usage aggregation.`,
      );
    }
  }
}

export function mergeRunAttemptUsageSummaries(
  summaries: readonly RunAttemptUsageSummary[],
): Pick<
  EvaluationRunUsageMeasurement,
  "inputTokens" | "outputTokens" | "pricedCostUsdMicros" | "unpricedModelCalls"
> {
  let inputTokens = 0;
  let outputTokens = 0;
  let pricedCostUsdMicros = 0;
  let unpricedModelCalls = 0;

  for (const summary of summaries) {
    inputTokens += summary.inputTokens;
    outputTokens += summary.outputTokens;
    unpricedModelCalls += summary.unpricedModelCalls;
    if (summary.estimatedCostUsdMicros !== null) {
      pricedCostUsdMicros += summary.estimatedCostUsdMicros;
    }
  }

  return {
    inputTokens,
    outputTokens,
    pricedCostUsdMicros,
    unpricedModelCalls,
  };
}

export function computeEvaluationRunDurationMs(
  evaluationRun: EvaluationRun,
): number | undefined {
  const startedAt = evaluationRun.startedAt;
  const completedAt = evaluationRun.completedAt;
  if (startedAt === undefined || completedAt === undefined) {
    return undefined;
  }

  if (
    !(TERMINAL_EVALUATION_RUN_STATES as readonly string[]).includes(
      evaluationRun.status,
    )
  ) {
    return undefined;
  }

  const durationMs = completedAt.getTime() - startedAt.getTime();
  if (!Number.isFinite(durationMs) || durationMs < 0) {
    return undefined;
  }

  return durationMs;
}
