import { INFERENCE_MODEL_INVOCATION_SOURCES } from "@osva-ai/contracts";
import type { ModelProfileVersion } from "@osva/domain";
import {
  estimateModelCostUsdMicros,
  type FinalizeRunStepProps,
} from "@osva/domain";
import type { ProviderGenerateTextResult } from "@osva/model-gateway";

export function buildModelRunStepFinalizeProps(input: {
  readonly outcome: ProviderGenerateTextResult | undefined;
  readonly version: ModelProfileVersion | null;
  readonly status: "SUCCEEDED" | "FAILED";
  readonly completedAt: Date;
  readonly errorCode?: string;
}): FinalizeRunStepProps {
  const invocationSource = input.outcome?.invocationSource;
  const osvaCacheHit =
    invocationSource === INFERENCE_MODEL_INVOCATION_SOURCES[2];

  if (osvaCacheHit && input.status === "SUCCEEDED") {
    return {
      status: input.status,
      completedAt: input.completedAt,
      errorCode: input.errorCode,
      modelInvocationSource: invocationSource,
      estimatedAvoidedCostUsdMicros:
        input.outcome?.estimatedAvoidedCostUsdMicros ?? null,
      estimatedCostUsdMicros: null,
    };
  }

  const usage = input.outcome?.usage;
  const usagePresent = usage !== undefined;

  const estimatedCostUsdMicros =
    usage === undefined
      ? null
      : estimateModelCostUsdMicros(
          {
            inputTokens: usage.inputTokens,
            outputTokens: usage.outputTokens,
            cachedInputTokens: usage.cachedInputTokens,
            cacheWriteInputTokens: usage.cacheWriteInputTokens,
          },
          input.version?.pricing,
          {
            configuredProviderModelId: input.version?.model,
            providerReportedModelId:
              input.outcome?.invocation?.providerReportedModelId,
            usageIncomplete: usage.incomplete,
          },
        );

  return {
    status: input.status,
    completedAt: input.completedAt,
    errorCode: input.errorCode,
    ...(usagePresent
      ? {
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          totalTokens: usage.totalTokens,
          cachedInputTokens: usage.cachedInputTokens,
          cacheWriteInputTokens: usage.cacheWriteInputTokens,
          usageIncomplete: usage.incomplete === true ? true : false,
        }
      : {}),
    ...(input.outcome?.invocation?.providerReportedModelId !== undefined
      ? {
          providerReportedModelId:
            input.outcome.invocation.providerReportedModelId,
        }
      : {}),
    ...(input.outcome?.providerRequestId !== undefined
      ? { providerRequestId: input.outcome.providerRequestId }
      : {}),
    estimatedCostUsdMicros,
    ...(invocationSource !== undefined
      ? { modelInvocationSource: invocationSource }
      : {}),
    ...(input.outcome?.estimatedAvoidedCostUsdMicros !== undefined
      ? {
          estimatedAvoidedCostUsdMicros:
            input.outcome.estimatedAvoidedCostUsdMicros,
        }
      : {}),
  };
}
