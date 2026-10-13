import http from "node:http";

import {
  readinessFailureBody,
  ReadinessUnavailableError,
} from "./readiness-result.js";

export interface ProcessProbeBind {
  readonly host: string;
  readonly port: number;
}

export interface ProcessProbeServer {
  readonly host: string;
  readonly port: number;
  close(): Promise<void>;
}

export interface StartProcessProbeServerOptions {
  readonly host: string;
  readonly port: number;
  readonly readinessCheck: () => Promise<void>;
}

const DEFAULT_HEALTH_HOST = "127.0.0.1";

/**
 * Minimal /health and /ready HTTP surface for long-running OSVA processes.
 * /health is liveness (event loop is serving). /ready re-checks dependencies
 * and must not succeed solely because the process exists.
 */
export function readProcessProbeBind(
  env: NodeJS.ProcessEnv = process.env,
): ProcessProbeBind {
  return {
    host: env.OSVA_HEALTH_HOST?.trim() || DEFAULT_HEALTH_HOST,
    port: readHealthPort(env.OSVA_HEALTH_PORT),
  };
}

export async function startProcessProbeServer(
  options: StartProcessProbeServerOptions,
): Promise<ProcessProbeServer | undefined> {
  if (options.port <= 0) {
    return undefined;
  }

  const server = http.createServer((request, response) => {
    void handleProbeRequest(request, response, options.readinessCheck);
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port, options.host, () => {
      server.off("error", reject);
      resolve();
    });
  });

  const address = server.address();
  const port =
    typeof address === "object" && address !== null
      ? address.port
      : options.port;

  return {
    host: options.host,
    port,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      }),
  };
}

async function handleProbeRequest(
  request: http.IncomingMessage,
  response: http.ServerResponse,
  readinessCheck: () => Promise<void>,
): Promise<void> {
  const method = request.method ?? "GET";
  const path = requestUrl(request).pathname;

  if (method !== "GET") {
    sendJson(response, 405, { status: "method_not_allowed" }, { allow: "GET" });
    return;
  }

  if (path === "/health") {
    sendJson(response, 200, { status: "ok" });
    return;
  }

  if (path === "/ready") {
    try {
      await readinessCheck();
      sendJson(response, 200, { status: "ready" });
    } catch (error) {
      sendJson(
        response,
        503,
        readinessFailureBody(
          error instanceof ReadinessUnavailableError
            ? error.failedDependencies
            : [],
        ),
      );
    }
    return;
  }

  sendJson(response, 404, { status: "not_found" });
}

function requestUrl(request: http.IncomingMessage): URL {
  return new URL(request.url ?? "/", "http://127.0.0.1");
}

function sendJson(
  response: http.ServerResponse,
  status: number,
  body: Readonly<Record<string, unknown>>,
  headers: Readonly<Record<string, string>> = {},
): void {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
    ...headers,
  });
  response.end(payload);
}

function readHealthPort(value: string | undefined): number {
  if (value === undefined || value.trim().length === 0) {
    return 0;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 65_535) {
    throw new Error("OSVA_HEALTH_PORT must be an integer between 0 and 65535.");
  }

  return parsed;
}
