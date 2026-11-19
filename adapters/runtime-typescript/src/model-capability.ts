import { randomUUID } from "node:crypto";

import type {
  GenerateCompletionInput,
  GenerateTextInput,
  GenerateTextResult,
  ModelStreamEvent,
} from "@osva-ai/contracts";

import {
  MODEL_STREAM_EVENT_FORMAT_VERSION,
  MODEL_STREAM_MAX_EVENT_COUNT,
  ModelErrorCode,
  isModelBindingName,
  isModelStreamTerminalKind,
} from "./constants.js";
import {
  isGenerateCompletionInput,
  isModelGenerateFailedMessage,
  isModelGenerateStreamEventMessage,
  isModelGenerateSucceededMessage,
  isParentToChildModelMessage,
  type ModelGenerateRequestMessage,
  type ModelGenerateStreamRequestMessage,
} from "./protocol.js";

export class ModelCapabilityError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "ModelCapabilityError";
    this.code = code;
  }
}

export interface TrustedAgentModels {
  generateText(
    binding: string,
    request: GenerateTextInput,
  ): Promise<GenerateTextResult>;
  generateCompletionStream(
    binding: string,
    request: GenerateCompletionInput,
  ): AsyncIterable<ModelStreamEvent>;
}

type TextWaiter = {
  readonly resolve: (result: GenerateTextResult) => void;
  readonly reject: (error: ModelCapabilityError) => void;
};

type StreamWaiter = {
  push(event: ModelStreamEvent): void;
  fail(code: string, message: string): void;
  eventCount: number;
  closed: boolean;
};

const textPending = new Map<string, TextWaiter>();
const streamPending = new Map<string, StreamWaiter>();

export function dispatchParentModelMessage(raw: unknown): void {
  if (!isParentToChildModelMessage(raw)) {
    return;
  }

  if (isModelGenerateFailedMessage(raw)) {
    const stream = streamPending.get(raw.callId);
    if (stream !== undefined && !stream.closed) {
      stream.fail(raw.error.code, raw.error.message);
      return;
    }
  }

  if (isModelGenerateStreamEventMessage(raw)) {
    const stream = streamPending.get(raw.callId);
    if (stream === undefined || stream.closed) {
      return;
    }

    const event = raw.event as unknown as ModelStreamEvent;

    stream.eventCount += 1;
    if (stream.eventCount > MODEL_STREAM_MAX_EVENT_COUNT) {
      stream.fail(
        ModelErrorCode.MODEL_PROVIDER_ERROR,
        "The model stream exceeded the maximum event count.",
      );
      return;
    }

    stream.push(event);
    if (isModelStreamTerminalKind(event.kind)) {
      stream.closed = true;
      streamPending.delete(raw.callId);
    }
    return;
  }

  const textWaiter = textPending.get(raw.callId);
  if (textWaiter === undefined) {
    return;
  }

  textPending.delete(raw.callId);
  if (isModelGenerateSucceededMessage(raw)) {
    textWaiter.resolve(raw.result);
    return;
  }

  if (isModelGenerateFailedMessage(raw)) {
    textWaiter.reject(
      new ModelCapabilityError(raw.error.code, raw.error.message),
    );
  }
}

function assertBinding(binding: string): void {
  if (!isModelBindingName(binding)) {
    throw new ModelCapabilityError(
      ModelErrorCode.MODEL_BINDING_NOT_FOUND,
      "Model binding was not found.",
    );
  }
}

function assertProcessSend(): (message: unknown) => boolean {
  const send = process.send;
  if (typeof send !== "function") {
    throw new ModelCapabilityError(
      ModelErrorCode.MODEL_PROVIDER_ERROR,
      "Model capability is unavailable.",
    );
  }
  return send.bind(process) as (message: unknown) => boolean;
}

function sendStreamClose(callId: string): void {
  try {
    const send = assertProcessSend();
    send({
      v: 1,
      type: "model.generate.stream.close",
      callId,
    });
  } catch {
    // Child is shutting down.
  }
}

export function createTrustedAgentModels(): TrustedAgentModels {
  return {
    generateText(binding, request) {
      return new Promise((resolve, reject) => {
        try {
          assertBinding(binding);
          const send = assertProcessSend();
          const callId = randomUUID();
          const message: ModelGenerateRequestMessage = {
            v: 1,
            type: "model.generate.request",
            callId,
            binding,
            request,
          };

          textPending.set(callId, { resolve, reject });
          const sent = send(message);
          if (!sent) {
            textPending.delete(callId);
            reject(
              new ModelCapabilityError(
                ModelErrorCode.MODEL_PROVIDER_ERROR,
                "Model capability is unavailable.",
              ),
            );
          }
        } catch (error) {
          reject(error);
        }
      });
    },

    generateCompletionStream(binding, request) {
      if (!isGenerateCompletionInput(request)) {
        throw new ModelCapabilityError(
          ModelErrorCode.MODEL_INVALID_REQUEST,
          "Model stream request is invalid.",
        );
      }

      assertBinding(binding);
      const send = assertProcessSend();
      const callId = randomUUID();

      let expectedSequence = 0;
      let streamStreamId: string | undefined;
      const queue: ModelStreamEvent[] = [];
      let waiting:
        | {
            readonly resolve: (value: IteratorResult<ModelStreamEvent>) => void;
            readonly reject: (error: unknown) => void;
          }
        | undefined;
      let failed: ModelCapabilityError | undefined;
      let completed = false;

      const waiter: StreamWaiter = {
        eventCount: 0,
        closed: false,
        push(event: ModelStreamEvent) {
          if (event.streamFormatVersion !== MODEL_STREAM_EVENT_FORMAT_VERSION) {
            waiter.fail(
              ModelErrorCode.INVALID_MODEL_RESPONSE,
              "The model provider returned an unsupported stream format.",
            );
            return;
          }
          if (
            streamStreamId !== undefined &&
            event.streamId !== streamStreamId
          ) {
            waiter.fail(
              ModelErrorCode.INVALID_MODEL_RESPONSE,
              "The model provider returned a mismatched stream identity.",
            );
            return;
          }
          if (streamStreamId === undefined) {
            streamStreamId = event.streamId;
          }
          if (event.sequence !== expectedSequence) {
            waiter.fail(
              ModelErrorCode.INVALID_MODEL_RESPONSE,
              "The model provider returned an out-of-order stream event.",
            );
            return;
          }
          expectedSequence += 1;

          const terminal = isModelStreamTerminalKind(event.kind);
          if (waiting !== undefined) {
            const current = waiting;
            waiting = undefined;
            if (terminal) {
              completed = true;
            }
            current.resolve({ value: event, done: false });
          } else {
            queue.push(event);
            if (terminal) {
              completed = true;
            }
          }
        },
        fail(code: string, message: string) {
          if (completed) {
            return;
          }
          completed = true;
          waiter.closed = true;
          streamPending.delete(callId);
          failed = new ModelCapabilityError(code, message);
          if (waiting !== undefined) {
            const current = waiting;
            waiting = undefined;
            current.reject(failed);
          }
        },
      };

      streamPending.set(callId, waiter);

      const message: ModelGenerateStreamRequestMessage = {
        v: 1,
        type: "model.generate.stream.request",
        callId,
        binding,
        request,
      };

      const sent = send(message);
      if (!sent) {
        streamPending.delete(callId);
        throw new ModelCapabilityError(
          ModelErrorCode.MODEL_PROVIDER_ERROR,
          "Model capability is unavailable.",
        );
      }

      const iterator: AsyncIterable<ModelStreamEvent> = {
        [Symbol.asyncIterator]() {
          return {
            async next(): Promise<IteratorResult<ModelStreamEvent>> {
              if (failed !== undefined) {
                throw failed;
              }
              if (queue.length > 0) {
                const value = queue.shift()!;
                if (isModelStreamTerminalKind(value.kind)) {
                  completed = true;
                  streamPending.delete(callId);
                }
                return { value, done: false };
              }
              if (completed) {
                return { value: undefined, done: true };
              }

              return await new Promise<IteratorResult<ModelStreamEvent>>(
                (resolve, reject) => {
                  waiting = { resolve, reject };
                },
              );
            },
            async return(): Promise<IteratorResult<ModelStreamEvent>> {
              if (!completed) {
                completed = true;
                sendStreamClose(callId);
                streamPending.delete(callId);
              }
              return { value: undefined, done: true };
            },
          };
        },
      };

      return iterator;
    },
  };
}
