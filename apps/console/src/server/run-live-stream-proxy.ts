import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

/** Idle timeout between SSE chunks after upstream headers arrive. */
export const RUN_LIVE_STREAM_PROXY_IDLE_TIMEOUT_MS = 120_000;

/** Hard cap on one proxied live stream connection (matches web SSE lifetime). */
export const RUN_LIVE_STREAM_PROXY_MAX_LIFETIME_MS = 3_600_000;

export const RUN_LIVE_STREAM_PROXY_MAX_CONNECTIONS = 64;

let activeRunLiveStreams = 0;

export function runLiveStreamProxyCapacitySnapshot(): {
  readonly active: number;
  readonly max: number;
} {
  return {
    active: activeRunLiveStreams,
    max: RUN_LIVE_STREAM_PROXY_MAX_CONNECTIONS,
  };
}

const SSE_CONTENT_TYPE = /^text\/event-stream(?:\s*;\s*charset=utf-8)?$/i;

export function buildRunLiveStreamProxyHeaders(input: {
  readonly contentType?: string;
  readonly requestId?: string;
}): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": safeSseContentType(input.contentType),
    "Cache-Control": "no-cache, no-store",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
    "X-Content-Type-Options": "nosniff",
  };
  if (input.requestId !== undefined && input.requestId.trim().length > 0) {
    headers["x-osva-request-id"] = input.requestId.trim();
  }
  return headers;
}

function safeSseContentType(value: string | undefined): string {
  if (value === undefined || value.trim().length === 0) {
    return "text/event-stream; charset=utf-8";
  }
  const trimmed = value.trim();
  if (!SSE_CONTENT_TYPE.test(trimmed)) {
    return "text/event-stream; charset=utf-8";
  }
  return trimmed;
}

export function tryAcquireRunLiveStreamSlot(): boolean {
  if (activeRunLiveStreams >= RUN_LIVE_STREAM_PROXY_MAX_CONNECTIONS) {
    return false;
  }
  activeRunLiveStreams += 1;
  return true;
}

export function releaseRunLiveStreamSlot(): void {
  activeRunLiveStreams = Math.max(0, activeRunLiveStreams - 1);
}

export async function pipeRunLiveStreamToResponse(input: {
  readonly body: ReadableStream<Uint8Array>;
  readonly request: IncomingMessage;
  readonly response: ServerResponse;
}): Promise<void> {
  const nodeStream = Readable.fromWeb(
    input.body as import("node:stream/web").ReadableStream<Uint8Array>,
  );
  const idleWatchdog = createIdleWatchdog(
    RUN_LIVE_STREAM_PROXY_IDLE_TIMEOUT_MS,
  );
  const lifetimeTimer = setTimeout(() => {
    nodeStream.destroy(new Error("Run live stream proxy lifetime exceeded."));
  }, RUN_LIVE_STREAM_PROXY_MAX_LIFETIME_MS);

  const abortUpstream = () => {
    nodeStream.destroy();
  };
  input.request.once("close", abortUpstream);

  try {
    await pipeline(nodeStream, idleWatchdog.transform, input.response);
  } catch {
    if (!input.response.writableEnded) {
      input.response.destroy();
    }
  } finally {
    clearTimeout(lifetimeTimer);
    idleWatchdog.dispose();
    input.request.off("close", abortUpstream);
    releaseRunLiveStreamSlot();
  }
}

function createIdleWatchdog(idleTimeoutMs: number): {
  readonly transform: Transform;
  dispose(): void;
} {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const transform = new Transform({
    transform(chunk, _encoding, callback) {
      arm();
      callback(null, chunk);
    },
  });

  const arm = () => {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
    timer = setTimeout(() => {
      transform.destroy(new Error("Run live stream proxy idle timeout."));
    }, idleTimeoutMs);
  };

  arm();

  return {
    transform,
    dispose() {
      if (timer !== undefined) {
        clearTimeout(timer);
      }
    },
  };
}
