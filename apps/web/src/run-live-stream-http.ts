import type { IncomingMessage, ServerResponse } from "node:http";
import { ValkeyRunLiveStreamSubscription } from "@osva/adapters-run-live-stream-valkey";
import type { RunId, RunLiveStreamViewerEnvelope } from "@osva-ai/contracts";
import {
  RUN_LIVE_STREAM_DEFAULT_MAX_SSE_CONNECTIONS,
  RUN_LIVE_STREAM_VIEWER_FORMAT_VERSION,
} from "@osva-ai/contracts";
import {
  CONTROL_PLANE_RESOURCE_KINDS,
  type RunApplication,
} from "@osva/domain";

import {
  authorizeControlPlaneRead,
  requireControlPlaneScope,
  requireControlPlaneWorkspaceId,
} from "./control-plane-http.js";
import { sendHttpError } from "./http-errors.js";
import { sendJson } from "./json.js";

export interface RunLiveStreamHttpServices {
  readonly runs: RunApplication;
  readonly valkeyUrl: string;
  readonly enabled: boolean;
  readonly maxConnections?: number;
}

const SSE_HEARTBEAT_MS = 15_000;
const SSE_MAX_LIFETIME_MS = 3_600_000;

let activeSseConnections = 0;

export const V1_RUN_LIVE_STREAM_ROUTES = [
  { method: "GET", path: "/v1/runs/:runId/stream" },
] as const;

export const V1_HTTP_ROUTES = V1_RUN_LIVE_STREAM_ROUTES;

interface RunLiveStreamRouteMatch {
  readonly runId: RunId;
}

function matchRunLiveStreamRoute(
  path: string,
): RunLiveStreamRouteMatch | undefined {
  if (!path.startsWith("/v1/runs/")) {
    return undefined;
  }
  const segments = path
    .slice("/v1/runs/".length)
    .split("/")
    .filter((segment) => segment.length > 0)
    .map((segment) => decodeURIComponent(segment));
  if (segments.length === 2 && segments[1] === "stream") {
    return { runId: segments[0] as RunId };
  }
  return undefined;
}

function writeSse(
  response: ServerResponse,
  event: string,
  data: unknown,
): void {
  response.write(`event: ${event}\n`);
  response.write(`data: ${JSON.stringify(data)}\n\n`);
}

export async function handleRunLiveStreamRequest(
  request: IncomingMessage,
  response: ServerResponse,
  method: string,
  path: string,
  services: RunLiveStreamHttpServices,
): Promise<boolean> {
  const route = matchRunLiveStreamRoute(path);
  if (route === undefined) {
    return false;
  }

  if (method !== "GET") {
    sendJson(response, 405, { status: "method_not_allowed" }, { allow: "GET" });
    return true;
  }

  if (!services.enabled) {
    sendJson(response, 503, {
      status: "unavailable",
      code: "run_live_stream_disabled",
    });
    return true;
  }

  const maxConnections =
    services.maxConnections ?? RUN_LIVE_STREAM_DEFAULT_MAX_SSE_CONNECTIONS;
  if (activeSseConnections >= maxConnections) {
    sendJson(response, 503, {
      status: "unavailable",
      code: "run_live_stream_capacity",
    });
    return true;
  }

  try {
    const scope = requireControlPlaneScope();
    authorizeControlPlaneRead(scope, CONTROL_PLANE_RESOURCE_KINDS.run);
    const workspaceId = requireControlPlaneWorkspaceId();
    const run = await services.runs.getRun.execute(scope, route.runId);
    if (run.workspaceId !== workspaceId) {
      sendJson(response, 404, { status: "not_found" });
      return true;
    }

    if (
      run.status === "SUCCEEDED" ||
      run.status === "FAILED" ||
      run.status === "CANCELLED"
    ) {
      response.writeHead(200, {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache, no-store",
        connection: "keep-alive",
        "x-accel-buffering": "no",
      });
      writeSse(response, "run-live", {
        formatVersion: RUN_LIVE_STREAM_VIEWER_FORMAT_VERSION,
        workspaceId,
        runId: run.id,
        viewerEvent: {
          kind: "STREAM_STATUS",
          status: run.status === "SUCCEEDED" ? "ended" : "failed",
          message: "Run already completed; live replay is not available.",
        },
      });
      response.end();
      return true;
    }

    activeSseConnections += 1;
    const subscription = new ValkeyRunLiveStreamSubscription({
      url: services.valkeyUrl,
      workspaceId,
      runId: run.id,
      onEnvelope(envelope) {
        if (response.writableEnded) {
          return;
        }
        if (envelope.workspaceId !== workspaceId || envelope.runId !== run.id) {
          return;
        }
        writeSse(response, "run-live", envelope);
        if (
          envelope.viewerEvent.kind === "STREAM_STATUS" &&
          (envelope.viewerEvent.status === "ended" ||
            envelope.viewerEvent.status === "failed")
        ) {
          response.end();
        }
      },
      onError() {
        if (!response.writableEnded) {
          writeSse(response, "run-live", {
            formatVersion: RUN_LIVE_STREAM_VIEWER_FORMAT_VERSION,
            workspaceId,
            runId: run.id,
            viewerEvent: {
              kind: "STREAM_STATUS",
              status: "failed",
              message: "Live stream transport error.",
            },
          });
        }
      },
    });

    const release = () => {
      activeSseConnections = Math.max(0, activeSseConnections - 1);
      void subscription.stop();
    };

    request.on("close", release);
    response.on("close", release);

    await subscription.start();
    await subscription.waitUntilReady();

    response.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-store",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    });

    writeSse(response, "ready", {
      formatVersion: RUN_LIVE_STREAM_VIEWER_FORMAT_VERSION,
      runId: run.id,
      replay: false,
    });

    const startedAt = Date.now();
    const heartbeat = setInterval(() => {
      if (response.writableEnded) {
        clearInterval(heartbeat);
        return;
      }
      if (Date.now() - startedAt > SSE_MAX_LIFETIME_MS) {
        clearInterval(heartbeat);
        response.end();
        return;
      }
      writeSse(response, "heartbeat", { ts: new Date().toISOString() });
    }, SSE_HEARTBEAT_MS);

    response.on("close", () => {
      clearInterval(heartbeat);
    });
  } catch (error) {
    activeSseConnections = Math.max(0, activeSseConnections - 1);
    sendHttpError(response, error);
  }

  return true;
}

export type RunLiveStreamSseEnvelope = RunLiveStreamViewerEnvelope;
