import type { ModelUsage } from "@osva-ai/contracts";

import type { BuilderGenerationMeasuredUsageV1 } from "./builder-natural-language-generation-types.js";

export function mergeBuilderModelUsage(
  prior: BuilderGenerationMeasuredUsageV1 | undefined,
  attempt: ModelUsage | undefined,
): BuilderGenerationMeasuredUsageV1 | undefined {
  if (attempt === undefined) {
    return prior;
  }

  const cached =
    attempt.cachedUnits !== undefined
      ? (prior?.cachedUnits ?? 0) + attempt.cachedUnits
      : prior?.cachedUnits;

  return {
    inputUnits: (prior?.inputUnits ?? 0) + attempt.inputUnits,
    outputUnits: (prior?.outputUnits ?? 0) + attempt.outputUnits,
    cachedUnits: cached,
    usageMeasured: true,
  };
}
