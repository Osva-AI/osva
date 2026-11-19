import type { InferenceModelInvocationSource } from "./inference-cache.js";
import type {
  GenerateCompletionResult,
  ModelErrorCode,
  ModelFinishReason,
  ModelUsage,
} from "./model-gateway.js";

/**
 * Portable model token/event stream format. Bump when event shape changes.
 */
export const MODEL_STREAM_EVENT_FORMAT_VERSION = "1" as const;

export type ModelStreamEventFormatVersion =
  typeof MODEL_STREAM_EVENT_FORMAT_VERSION;

/**
 * Correlates all events from one logical provider invocation (one RunStep model
 * call). Distinct from provider response ids on {@link ModelStreamCompletedEvent}.
 */
export type ModelStreamId = string;

export const MODEL_STREAM_EVENT_KINDS = [
  "TEXT_DELTA",
  "TOOL_CALL_START",
  "TOOL_CALL_ARGUMENTS_DELTA",
  "TOOL_CALL_COMPLETE",
  "USAGE_FINAL",
  "COMPLETED",
  "FAILED",
  "CANCELLED",
] as const;

export type ModelStreamEventKind = (typeof MODEL_STREAM_EVENT_KINDS)[number];

export const MODEL_STREAM_TERMINAL_KINDS = [
  "COMPLETED",
  "FAILED",
  "CANCELLED",
] as const;

export type ModelStreamTerminalKind =
  (typeof MODEL_STREAM_TERMINAL_KINDS)[number];

/** Upper bound for a single TEXT_DELTA payload (bytes, UTF-8). */
export const MODEL_STREAM_MAX_TEXT_DELTA_BYTES = 16_384;

/** Upper bound for accumulated tool-call argument material per call (bytes). */
export const MODEL_STREAM_MAX_TOOL_ARGUMENT_BYTES = 65_536;

/** Defensive upper bound on events accepted by terminal assembly. */
export const MODEL_STREAM_MAX_EVENT_COUNT = 100_000;

export interface ModelStreamEventBase {
  readonly streamFormatVersion: ModelStreamEventFormatVersion;
  /** Stable identity for one streamed invocation. */
  readonly streamId: ModelStreamId;
  /** Zero-based, strictly increasing per {@link streamId}. */
  readonly sequence: number;
  readonly kind: ModelStreamEventKind;
}

export interface ModelStreamTextDeltaEvent extends ModelStreamEventBase {
  readonly kind: "TEXT_DELTA";
  readonly textDelta: string;
}

export interface ModelStreamToolCallStartEvent extends ModelStreamEventBase {
  readonly kind: "TOOL_CALL_START";
  /** Stable ordinal within this stream; matches deltas and complete events. */
  readonly toolCallIndex: number;
  readonly toolCallId: string;
  readonly name: string;
}

export interface ModelStreamToolCallArgumentsDeltaEvent extends ModelStreamEventBase {
  readonly kind: "TOOL_CALL_ARGUMENTS_DELTA";
  readonly toolCallIndex: number;
  /** UTF-8 JSON fragment appended in order for the target tool call. */
  readonly argumentsDelta: string;
}

export interface ModelStreamToolCallCompleteEvent extends ModelStreamEventBase {
  readonly kind: "TOOL_CALL_COMPLETE";
  readonly toolCallIndex: number;
  /** When present, replaces accumulated argument fragments after JSON parse. */
  readonly arguments?: unknown;
}

export interface ModelStreamUsageFinalEvent extends ModelStreamEventBase {
  readonly kind: "USAGE_FINAL";
  /**
   * Provider-reported usage only. Omit entire event when the provider reports
   * nothing; never fabricate zeros.
   */
  readonly usage: ModelUsage;
  readonly invocationSource?: InferenceModelInvocationSource;
  readonly providerRequestId?: string;
}

export interface ModelStreamCompletedEvent extends ModelStreamEventBase {
  readonly kind: "COMPLETED";
  readonly finishReason: ModelFinishReason;
  readonly providerRequestId?: string;
}

export interface ModelStreamFailedEvent extends ModelStreamEventBase {
  readonly kind: "FAILED";
  readonly code: ModelErrorCode;
  readonly message: string;
  readonly retryable?: boolean;
}

export const MODEL_STREAM_CANCELLATION_REASONS = [
  "CONSUMER_ABORT",
  "EXECUTION_CANCELLED",
  "PROVIDER_ABORT",
  "OTHER",
] as const;

export type ModelStreamCancellationReason =
  (typeof MODEL_STREAM_CANCELLATION_REASONS)[number];

export interface ModelStreamCancelledEvent extends ModelStreamEventBase {
  readonly kind: "CANCELLED";
  readonly reason?: ModelStreamCancellationReason;
}

export type ModelStreamEvent =
  | ModelStreamTextDeltaEvent
  | ModelStreamToolCallStartEvent
  | ModelStreamToolCallArgumentsDeltaEvent
  | ModelStreamToolCallCompleteEvent
  | ModelStreamUsageFinalEvent
  | ModelStreamCompletedEvent
  | ModelStreamFailedEvent
  | ModelStreamCancelledEvent;

/**
 * In-process producer shape for {@link ModelGateway} streaming (B2.2+).
 * Trusted runtime IPC must use discrete framed {@link ModelStreamEvent} values,
 * not serialized AsyncIterable instances.
 */
export type ModelStreamEventSource = AsyncIterable<ModelStreamEvent>;

export const MODEL_STREAM_ASSEMBLY_FAILURE_REASONS = [
  "UNSUPPORTED_FORMAT_VERSION",
  "EMPTY_EVENT_LIST",
  "SEQUENCE_OUT_OF_ORDER",
  "DUPLICATE_SEQUENCE",
  "DUPLICATE_TERMINAL",
  "DUPLICATE_USAGE",
  "MISSING_TERMINAL",
  "TERMINAL_NOT_LAST",
  "INVALID_TOOL_CALL_SEQUENCE",
  "INVALID_TOOL_ARGUMENTS",
  "TEXT_DELTA_TOO_LARGE",
  "TOOL_ARGUMENTS_TOO_LARGE",
  "TOO_MANY_EVENTS",
  "PARTIAL_SUCCESS_REJECTED",
  "UNSUPPORTED_EVENT_KIND",
  "STREAM_FAILED",
  "STREAM_CANCELLED",
] as const;

export type ModelStreamAssemblyFailureReason =
  (typeof MODEL_STREAM_ASSEMBLY_FAILURE_REASONS)[number];

export interface ModelStreamAssemblyFailure {
  readonly ok: false;
  readonly reason: ModelStreamAssemblyFailureReason;
  readonly code?: ModelErrorCode;
  readonly message?: string;
}

export interface ModelStreamAssemblySuccess {
  readonly ok: true;
  readonly result: GenerateCompletionResult;
  readonly usage?: ModelUsage;
  readonly invocationSource?: InferenceModelInvocationSource;
  readonly providerRequestId?: string;
}

export type ModelStreamAssemblyOutcome =
  ModelStreamAssemblySuccess | ModelStreamAssemblyFailure;

export function isModelStreamTerminalKind(
  kind: ModelStreamEventKind,
): kind is ModelStreamTerminalKind {
  return (MODEL_STREAM_TERMINAL_KINDS as readonly string[]).includes(kind);
}
