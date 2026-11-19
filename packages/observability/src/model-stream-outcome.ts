import {
  MODEL_ERROR_CODES,
  assembleModelStreamCompletion,
  type ModelStreamEvent,
} from "@osva-ai/contracts";
import type { ProviderGenerateTextResult } from "@osva/model-gateway";

export function providerOutcomeFromModelStream(
  events: readonly ModelStreamEvent[],
):
  | {
      readonly status: "SUCCEEDED";
      readonly outcome: ProviderGenerateTextResult;
    }
  | {
      readonly status: "FAILED";
      readonly errorCode: string;
      readonly outcome?: ProviderGenerateTextResult;
    } {
  const assembled = assembleModelStreamCompletion(events);
  if (!assembled.ok) {
    const errorCode =
      assembled.code ??
      (assembled.reason === "STREAM_CANCELLED"
        ? MODEL_ERROR_CODES.MODEL_CANCELLED
        : MODEL_ERROR_CODES.MODEL_PROVIDER_ERROR);
    return { status: "FAILED", errorCode };
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
