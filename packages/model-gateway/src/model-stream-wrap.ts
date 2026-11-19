import type {
  ModelStreamEvent,
  ModelStreamEventSource,
} from "@osva-ai/contracts";
import {
  MODEL_ERROR_CODES,
  MODEL_STREAM_EVENT_FORMAT_VERSION,
  MODEL_STREAM_MAX_EVENT_COUNT,
  isModelStreamTerminalKind,
} from "@osva-ai/contracts";

import { ModelGatewayError } from "./errors.js";

/**
 * Wraps a provider-produced stream with cancellation, bounds, and a missing-terminal
 * guard. Errors before the first yielded event propagate as throws.
 */
export function wrapModelCompletionStream(
  source: AsyncIterable<ModelStreamEvent>,
  signal?: AbortSignal,
): ModelStreamEventSource {
  return {
    [Symbol.asyncIterator]() {
      return iterateWrappedStream(source, signal);
    },
  };
}

async function* iterateWrappedStream(
  source: AsyncIterable<ModelStreamEvent>,
  signal: AbortSignal | undefined,
): AsyncGenerator<ModelStreamEvent> {
  let yielded = 0;
  let sawTerminal = false;
  let streamId: string | undefined;
  let nextSequence = 0;

  try {
    for await (const event of source) {
      if (signal?.aborted && !sawTerminal) {
        yield {
          streamFormatVersion: MODEL_STREAM_EVENT_FORMAT_VERSION,
          streamId: streamId ?? event.streamId,
          sequence: nextSequence,
          kind: "CANCELLED",
          reason: "EXECUTION_CANCELLED",
        };
        return;
      }

      yielded += 1;
      if (yielded > MODEL_STREAM_MAX_EVENT_COUNT) {
        throw new ModelGatewayError(
          MODEL_ERROR_CODES.MODEL_PROVIDER_ERROR,
          "The model stream exceeded the maximum event count.",
          { retryable: false },
        );
      }

      streamId = event.streamId;
      nextSequence = event.sequence + 1;
      yield event;

      if (isModelStreamTerminalKind(event.kind)) {
        sawTerminal = true;
        return;
      }
    }

    if (!sawTerminal) {
      yield {
        streamFormatVersion: MODEL_STREAM_EVENT_FORMAT_VERSION,
        streamId: streamId ?? "unknown",
        sequence: nextSequence,
        kind: "FAILED",
        code: MODEL_ERROR_CODES.INVALID_MODEL_RESPONSE,
        message: "The model provider stream ended without a terminal event.",
        retryable: false,
      };
    }
  } catch (error) {
    if (yielded === 0) {
      throw error;
    }
    if (error instanceof ModelGatewayError && !sawTerminal) {
      yield {
        streamFormatVersion: MODEL_STREAM_EVENT_FORMAT_VERSION,
        streamId: streamId ?? "unknown",
        sequence: nextSequence,
        kind: "FAILED",
        code: error.code,
        message: error.message,
        ...(error.retryable === true ? { retryable: true } : {}),
      };
      return;
    }
    throw error;
  }
}
