import type { ModelProfileVersion } from "./model-profile-version.js";
import type { EvaluationJudgeModelInvokeResult } from "./ports/evaluation-judge-model-invoker.js";
import { estimateModelCostUsdMicros } from "./model-cost.js";

export interface JudgeInvocationAttemptRecord {
  readonly attemptNumber: number;
  readonly outcome: "completed" | "provider_error" | "invalid_verdict";
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cachedInputTokens: number;
  readonly cacheWriteInputTokens: number;
  readonly configuredProviderModelId: string | null;
  readonly providerReportedModelId: string | null;
  readonly providerResponseId: string | null;
  readonly usageIncomplete: boolean;
  readonly pricedCostUsdMicros: number;
  readonly unpricedModelCalls: number;
}

/**
 * When provider outcome is absent (timeout/abort before response), usage stays
 * unknown — OSVA does not fabricate token counts or costs for ambiguous billing.
 */
export function judgeUsageAccountingFromInvocation(
  profileVersion: ModelProfileVersion,
  modelProfileVersionId: string,
  outcome: EvaluationJudgeModelInvokeResult,
  attemptNumber: number,
  invocationOutcome: JudgeInvocationAttemptRecord["outcome"],
): JudgeInvocationAttemptRecord {
  const usageIncomplete =
    outcome.usageIncomplete === true ||
    outcome.inputTokens === undefined ||
    outcome.outputTokens === undefined;

  const costUsdMicros = estimateModelCostUsdMicros(
    {
      inputTokens: outcome.inputTokens ?? 0,
      outputTokens: outcome.outputTokens ?? 0,
      cachedInputTokens: outcome.cachedInputTokens,
      cacheWriteInputTokens: outcome.cacheWriteInputTokens,
    },
    profileVersion.pricing,
    {
      configuredProviderModelId:
        outcome.configuredProviderModelId ?? profileVersion.model,
      providerReportedModelId: outcome.providerReportedModelId,
      usageIncomplete,
    },
  );

  return {
    attemptNumber,
    outcome: invocationOutcome,
    inputTokens: outcome.inputTokens ?? 0,
    outputTokens: outcome.outputTokens ?? 0,
    cachedInputTokens: outcome.cachedInputTokens ?? 0,
    cacheWriteInputTokens: outcome.cacheWriteInputTokens ?? 0,
    configuredProviderModelId:
      outcome.configuredProviderModelId ?? profileVersion.model,
    providerReportedModelId: outcome.providerReportedModelId ?? null,
    providerResponseId: outcome.providerResponseId ?? null,
    usageIncomplete,
    pricedCostUsdMicros: costUsdMicros ?? 0,
    unpricedModelCalls: costUsdMicros === null ? 1 : 0,
  };
}

export function aggregateJudgeInvocationAttempts(
  modelProfileVersionId: string,
  attempts: readonly JudgeInvocationAttemptRecord[],
): {
  readonly judgeUsageAccounting: Readonly<Record<string, unknown>>;
  readonly judgeInvocationAttempts: readonly Readonly<
    Record<string, unknown>
  >[];
} {
  const dedupedByAttempt = new Map<number, JudgeInvocationAttemptRecord>();
  for (const attempt of attempts) {
    if (!dedupedByAttempt.has(attempt.attemptNumber)) {
      dedupedByAttempt.set(attempt.attemptNumber, attempt);
    }
  }
  const deduped = [...dedupedByAttempt.values()].sort(
    (left, right) => left.attemptNumber - right.attemptNumber,
  );

  let inputTokens = 0;
  let outputTokens = 0;
  let pricedCostUsdMicros = 0;
  let unpricedModelCalls = 0;
  let usageMeasured = false;

  for (const attempt of deduped) {
    inputTokens += attempt.inputTokens;
    outputTokens += attempt.outputTokens;
    pricedCostUsdMicros += attempt.pricedCostUsdMicros;
    unpricedModelCalls += attempt.unpricedModelCalls;
    if (!attempt.usageIncomplete) {
      usageMeasured = true;
    }
  }

  const last = deduped[deduped.length - 1];
  return {
    judgeUsageAccounting: {
      role: "judge",
      modelProfileVersionId,
      inputTokens,
      outputTokens,
      pricedCostUsdMicros,
      unpricedModelCalls,
      usageMeasured,
      ...(last === undefined
        ? {}
        : {
            providerReportedModelId: last.providerReportedModelId,
            providerResponseId: last.providerResponseId,
          }),
    },
    judgeInvocationAttempts: deduped.map((attempt) => ({ ...attempt })),
  };
}
