import type { ModelStreamEvent } from "./model-streaming.js";
import type { RunAttemptId, RunId, WorkspaceId } from "./ids.js";

/** Viewer envelope format; bump when breaking SSE payload shape. */
export const RUN_LIVE_STREAM_VIEWER_FORMAT_VERSION = "1" as const;

/** Valkey Pub/Sub channel version segment (not durable; no replay). */
export const RUN_LIVE_STREAM_CHANNEL_VERSION = "v1" as const;

export const RUN_LIVE_STREAM_VIEWER_EVENT_KINDS = [
  "TEXT_DELTA",
  "STREAM_STATUS",
] as const;

export type RunLiveStreamViewerEventKind =
  (typeof RUN_LIVE_STREAM_VIEWER_EVENT_KINDS)[number];

export const RUN_LIVE_STREAM_STATUS_VALUES = [
  "receiving",
  "ended",
  "failed",
] as const;

export type RunLiveStreamStatus =
  (typeof RUN_LIVE_STREAM_STATUS_VALUES)[number];

export interface RunLiveStreamTextDeltaViewerEvent {
  readonly kind: "TEXT_DELTA";
  readonly textDelta: string;
}

export interface RunLiveStreamStatusViewerEvent {
  readonly kind: "STREAM_STATUS";
  readonly status: RunLiveStreamStatus;
  /** Public-safe short message; never provider diagnostics. */
  readonly message?: string;
}

export type RunLiveStreamViewerEvent =
  RunLiveStreamTextDeltaViewerEvent | RunLiveStreamStatusViewerEvent;

export interface RunLiveStreamViewerEnvelope {
  readonly formatVersion: typeof RUN_LIVE_STREAM_VIEWER_FORMAT_VERSION;
  readonly workspaceId: WorkspaceId;
  readonly runId: RunId;
  readonly runAttemptId: RunAttemptId;
  readonly streamId: string;
  readonly sequence: number;
  readonly emittedAt: string;
  readonly viewerEvent: RunLiveStreamViewerEvent;
}

/** Upper bound for one published JSON message (UTF-8 bytes). */
export const RUN_LIVE_STREAM_MAX_PUBLISH_BYTES = 32_768;

/** Per-viewer text fragment upper bound (UTF-16 code units; enforced at projection). */
export const RUN_LIVE_STREAM_MAX_VIEWER_TEXT_DELTA_CHARS = 4_096;

/** Default cap on simultaneous SSE subscribers per web process. */
export const RUN_LIVE_STREAM_DEFAULT_MAX_SSE_CONNECTIONS = 64;

/**
 * Trusted worker/web configuration for viewer projection (never from agent input).
 * When `textDeltasVisible` is false, TEXT_DELTA model events do not expose text.
 */
export interface RunLiveStreamViewerProjectionPolicy {
  readonly textDeltasVisible: boolean;
}

export const DEFAULT_RUN_LIVE_STREAM_VIEWER_POLICY: RunLiveStreamViewerProjectionPolicy =
  {
    textDeltasVisible: false,
  };

export function runLiveStreamChannelName(
  workspaceId: WorkspaceId,
  runId: RunId,
): string {
  return `osva:run-live:${RUN_LIVE_STREAM_CHANNEL_VERSION}:${workspaceId}:${runId}`;
}

/**
 * Projects agent-critical model events into viewer-safe SSE payloads.
 * Default deny: tool arguments, usage, provider internals, and unknown kinds.
 */
/** Optional cross-process live viewer transport (B2.4). Failures must not affect Runs. */
export interface RunLiveStreamPublisher {
  tryPublish(envelope: RunLiveStreamViewerEnvelope): void;
}

export function projectModelStreamEventToViewer(
  event: ModelStreamEvent,
  policy: RunLiveStreamViewerProjectionPolicy = DEFAULT_RUN_LIVE_STREAM_VIEWER_POLICY,
): RunLiveStreamViewerEvent | undefined {
  switch (event.kind) {
    case "TEXT_DELTA": {
      if (!policy.textDeltasVisible) {
        return { kind: "STREAM_STATUS", status: "receiving" };
      }
      const textDelta = event.textDelta;
      if (textDelta.length === 0) {
        return undefined;
      }
      if (textDelta.length > RUN_LIVE_STREAM_MAX_VIEWER_TEXT_DELTA_CHARS) {
        return undefined;
      }
      return { kind: "TEXT_DELTA", textDelta };
    }
    case "COMPLETED":
      return { kind: "STREAM_STATUS", status: "ended" };
    case "FAILED":
      return {
        kind: "STREAM_STATUS",
        status: "failed",
        message: "Model stream failed.",
      };
    case "CANCELLED":
      return {
        kind: "STREAM_STATUS",
        status: "failed",
        message: "Model stream was cancelled.",
      };
    default:
      return undefined;
  }
}
