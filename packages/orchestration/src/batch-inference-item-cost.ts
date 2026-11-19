import type {
  ModelProfileVersionPricing,
  ModelUsage,
} from "@osva-ai/contracts";
import { estimateModelCostUsdMicros } from "@osva/domain";

export function estimateBatchItemCostUsdMicros(input: {
  readonly usage: ModelUsage | undefined;
  readonly pricing: ModelProfileVersionPricing | undefined;
  readonly configuredProviderModelId: string;
}): number | undefined {
  if (input.usage === undefined || input.pricing === undefined) {
    return undefined;
  }
  const cost = estimateModelCostUsdMicros(
    {
      inputTokens: input.usage.inputUnits,
      outputTokens: input.usage.outputUnits,
      cachedInputTokens: input.usage.cachedUnits,
      cacheWriteInputTokens: undefined,
    },
    input.pricing,
    {
      configuredProviderModelId: input.configuredProviderModelId,
      providerReportedModelId: input.configuredProviderModelId,
    },
  );
  return cost ?? undefined;
}
