import {
  assembleModelStreamCompletion,
  type ModelStreamEvent,
} from "@osva-ai/contracts";

import type { ProviderGenerateTextResult } from "./usage.js";

export function providerOutcomeFromModelStreamEvents(
  events: readonly ModelStreamEvent[],
): {
  readonly status: "SUCCEEDED" | "FAILED" | "INCOMPLETE";
  readonly outcome?: ProviderGenerateTextResult;
} {
  if (events.length === 0) {
    return { status: "INCOMPLETE" };
  }

  const assembled = assembleModelStreamCompletion(events);
  if (!assembled.ok) {
    return { status: "FAILED" };
  }

  const usageSource = assembled.result.usage ?? assembled.usage;
  const usage =
    usageSource === undefined
      ? undefined
      : {
          inputTokens: usageSource.inputUnits,
          outputTokens: usageSource.outputUnits,
          totalTokens: usageSource.inputUnits + usageSource.outputUnits,
          ...(usageSource.cachedUnits !== undefined
            ? { cachedInputTokens: usageSource.cachedUnits }
            : {}),
        };

  return {
    status: "SUCCEEDED",
    outcome: {
      text: assembled.result.text,
      toolCalls: assembled.result.toolCalls,
      finishReason: assembled.result.finishReason,
      usage,
      providerRequestId: assembled.providerRequestId,
      invocationSource: assembled.invocationSource,
    },
  };
}
