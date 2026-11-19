import {
  RUN_LIVE_STREAM_MAX_VIEWER_TEXT_DELTA_CHARS,
  RUN_LIVE_STREAM_VIEWER_FORMAT_VERSION,
} from "@osva-ai/contracts";
import { runLiveStreamViewerEnvelopeSchema } from "@osva-ai/contracts/schemas";

/** Upper bound on aggregated partial viewer text kept in memory. */
export const RUN_LIVE_STREAM_CLIENT_MAX_AGGREGATE_CHARS = 65_536;

export const RUN_LIVE_STREAM_MAX_RECONNECT_ATTEMPTS = 2;

export type RunLiveStreamPhase =
  | "IDLE"
  | "CONNECTING"
  | "LIVE"
  | "DISCONNECTED"
  | "UNAVAILABLE"
  | "ENDED"
  | "ERROR";

export interface RunLiveStreamReadyEvent {
  readonly formatVersion: typeof RUN_LIVE_STREAM_VIEWER_FORMAT_VERSION;
  readonly runId: string;
  readonly replay: boolean;
}

export interface ParsedRunLiveSseMessage {
  readonly event: string;
  readonly data: unknown;
}

export interface RunLiveStreamAggregate {
  readonly partialText: string;
  readonly textVisible: boolean;
  readonly statusOnly: boolean;
  readonly lastSequence: number | undefined;
  readonly streamId: string | undefined;
  readonly historyGap: boolean;
}

export function parseSseBlock(
  block: string,
): ParsedRunLiveSseMessage | undefined {
  let event = "message";
  const dataLines: string[] = [];
  for (const line of block.split("\n")) {
    if (line.startsWith("event:")) {
      event = line.slice("event:".length).trim();
    } else if (line.startsWith("data:")) {
      dataLines.push(line.slice("data:".length).trim());
    }
  }
  if (dataLines.length === 0) {
    return undefined;
  }
  try {
    return {
      event,
      data: JSON.parse(dataLines.join("\n")) as unknown,
    };
  } catch {
    return undefined;
  }
}

export function applyRunLiveSseMessage(
  aggregate: RunLiveStreamAggregate,
  message: ParsedRunLiveSseMessage,
  expectedRunId: string,
): RunLiveStreamAggregate {
  if (message.event === "ready") {
    return aggregate;
  }
  if (message.event === "heartbeat") {
    return aggregate;
  }
  if (message.event !== "run-live") {
    return aggregate;
  }

  const parsed = runLiveStreamViewerEnvelopeSchema.safeParse(message.data);
  if (!parsed.success) {
    return aggregate;
  }
  if (parsed.data.runId !== expectedRunId) {
    return aggregate;
  }

  let historyGap = aggregate.historyGap;
  if (
    aggregate.lastSequence !== undefined &&
    parsed.data.sequence !== aggregate.lastSequence + 1
  ) {
    historyGap = true;
  }
  if (
    aggregate.streamId !== undefined &&
    parsed.data.streamId !== aggregate.streamId
  ) {
    historyGap = true;
  }

  const viewer = parsed.data.viewerEvent;
  if (viewer.kind === "TEXT_DELTA") {
    const delta = viewer.textDelta;
    if (delta.length > RUN_LIVE_STREAM_MAX_VIEWER_TEXT_DELTA_CHARS) {
      return {
        ...aggregate,
        historyGap,
        lastSequence: parsed.data.sequence,
        streamId: parsed.data.streamId,
      };
    }
    const combined = aggregate.partialText + delta;
    const bounded =
      combined.length > RUN_LIVE_STREAM_CLIENT_MAX_AGGREGATE_CHARS
        ? combined.slice(0, RUN_LIVE_STREAM_CLIENT_MAX_AGGREGATE_CHARS)
        : combined;
    return {
      partialText: bounded,
      textVisible: true,
      statusOnly: false,
      lastSequence: parsed.data.sequence,
      streamId: parsed.data.streamId,
      historyGap,
    };
  }

  if (viewer.kind === "STREAM_STATUS") {
    const statusOnly =
      viewer.status === "receiving" && !aggregate.textVisible
        ? true
        : aggregate.statusOnly && !aggregate.textVisible;
    return {
      ...aggregate,
      statusOnly,
      lastSequence: parsed.data.sequence,
      streamId: parsed.data.streamId,
      historyGap,
    };
  }

  return aggregate;
}

export function runLiveStreamTerminalFromStatus(
  data: unknown,
): "ended" | "failed" | undefined {
  const parsed = runLiveStreamViewerEnvelopeSchema.safeParse(data);
  if (!parsed.success) {
    return undefined;
  }
  if (parsed.data.viewerEvent.kind !== "STREAM_STATUS") {
    return undefined;
  }
  if (parsed.data.viewerEvent.status === "ended") {
    return "ended";
  }
  if (parsed.data.viewerEvent.status === "failed") {
    return "failed";
  }
  return undefined;
}

export function buildRunLiveStreamUrl(runId: string): string {
  return `/api/v1/runs/${encodeURIComponent(runId)}/stream`;
}
