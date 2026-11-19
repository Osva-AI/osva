import { randomUUID } from "node:crypto";

import type {
  InferenceModelInvocationSource,
  ModelErrorCode,
  ModelFinishReason,
  ModelStreamCancellationReason,
  ModelStreamEvent,
  ModelUsage,
} from "@osva-ai/contracts";
import {
  INFERENCE_MODEL_INVOCATION_SOURCES,
  MODEL_STREAM_EVENT_FORMAT_VERSION,
} from "@osva-ai/contracts";

import type { ModelGatewayError } from "./errors.js";

export class ModelStreamSession {
  readonly streamId: string;
  private sequence = 0;
  private closed = false;

  constructor(streamId?: string) {
    this.streamId = streamId ?? randomUUID();
  }

  private next(event: ModelStreamEvent): ModelStreamEvent {
    if (this.closed) {
      throw new Error("Model stream session already closed.");
    }
    const full: ModelStreamEvent = {
      ...event,
      streamFormatVersion: MODEL_STREAM_EVENT_FORMAT_VERSION,
      streamId: this.streamId,
      sequence: this.sequence,
    };
    this.sequence += 1;
    if (
      full.kind === "COMPLETED" ||
      full.kind === "FAILED" ||
      full.kind === "CANCELLED"
    ) {
      this.closed = true;
    }
    return full;
  }

  textDelta(textDelta: string): ModelStreamEvent {
    return this.next({ kind: "TEXT_DELTA", textDelta } as ModelStreamEvent);
  }

  toolCallStart(
    toolCallIndex: number,
    toolCallId: string,
    name: string,
  ): ModelStreamEvent {
    return this.next({
      kind: "TOOL_CALL_START",
      toolCallIndex,
      toolCallId,
      name,
    } as ModelStreamEvent);
  }

  toolCallArgumentsDelta(
    toolCallIndex: number,
    argumentsDelta: string,
  ): ModelStreamEvent {
    return this.next({
      kind: "TOOL_CALL_ARGUMENTS_DELTA",
      toolCallIndex,
      argumentsDelta,
    } as ModelStreamEvent);
  }

  toolCallComplete(toolCallIndex: number, args: unknown): ModelStreamEvent {
    return this.next({
      kind: "TOOL_CALL_COMPLETE",
      toolCallIndex,
      arguments: args,
    } as ModelStreamEvent);
  }

  usageFinal(
    usage: ModelUsage,
    invocationSource: InferenceModelInvocationSource = INFERENCE_MODEL_INVOCATION_SOURCES[0],
    providerRequestId?: string,
  ): ModelStreamEvent {
    return this.next({
      kind: "USAGE_FINAL",
      usage,
      invocationSource,
      ...(providerRequestId !== undefined ? { providerRequestId } : {}),
    } as ModelStreamEvent);
  }

  completed(
    finishReason: ModelFinishReason,
    providerRequestId?: string,
  ): ModelStreamEvent {
    return this.next({
      kind: "COMPLETED",
      finishReason,
      ...(providerRequestId !== undefined ? { providerRequestId } : {}),
    } as ModelStreamEvent);
  }

  failed(error: ModelGatewayError): ModelStreamEvent {
    return this.next({
      kind: "FAILED",
      code: error.code as ModelErrorCode,
      message: error.message,
      ...(error.retryable === true ? { retryable: true } : {}),
    } as ModelStreamEvent);
  }

  cancelled(reason?: ModelStreamCancellationReason): ModelStreamEvent {
    return this.next({
      kind: "CANCELLED",
      ...(reason !== undefined ? { reason } : {}),
    } as ModelStreamEvent);
  }
}
