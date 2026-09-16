import type { IncomingMessage, ServerResponse } from "node:http";
import http from "node:http";

import {
  RUNTIME_PROTOCOL_ERROR_CODES,
  RUNTIME_PROTOCOL_MAX_BODY_BYTES,
  RUNTIME_PROTOCOL_VERSION,
  type RuntimeExecuteResponse,
} from "@osva/runtime-protocol";

import { RuntimeProtocolError } from "./errors.js";
import type { RuntimeDefinition, RuntimeHandler } from "./handler.js";
import { createRuntimeHandler } from "./handler.js";

export interface NodeHttpRuntimeOptions {
  readonly path?: string;
  readonly fetch?: typeof fetch;
  readonly capabilityTimeoutMs?: number;
}

export function createNodeHttpHandler(
  runtime: RuntimeDefinition,
  options: NodeHttpRuntimeOptions = {},
): (request: IncomingMessage, response: ServerResponse) => void {
  const handler = createRuntimeHandler(runtime, {
    fetch: options.fetch,
    capabilityTimeoutMs: options.capabilityTimeoutMs,
  });
  const path = options.path ?? "/execute";

  return (request, response) => {
    void handleNodeHttpRequest(request, response, handler, path);
  };
}

export function createNodeHttpServer(
  runtime: RuntimeDefinition,
  options: NodeHttpRuntimeOptions = {},
): http.Server {
  return http.createServer(createNodeHttpHandler(runtime, options));
}

async function handleNodeHttpRequest(
  request: IncomingMessage,
  response: ServerResponse,
  handler: RuntimeHandler,
  path: string,
): Promise<void> {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");

  if (request.method !== "POST" || url.pathname !== path) {
    sendJson(response, 404, {
      protocolVersion: RUNTIME_PROTOCOL_VERSION,
      outcome: "FAILED",
      error: {
        code: RUNTIME_PROTOCOL_ERROR_CODES.PROTOCOL_FAILURE,
        message: "Not found.",
      },
    });
    return;
  }

  let raw: Buffer;
  try {
    raw = await readLimitedBody(request, RUNTIME_PROTOCOL_MAX_BODY_BYTES);
  } catch {
    sendJson(
      response,
      413,
      protocolFailure("Request body exceeds maximum size."),
    );
    return;
  }

  let body: unknown;
  try {
    body = JSON.parse(raw.toString("utf8"));
  } catch {
    sendJson(
      response,
      400,
      protocolFailure("Request body must be valid JSON."),
    );
    return;
  }

  let result: RuntimeExecuteResponse;
  try {
    result = await handler.handleExecuteRequest(body);
  } catch (error) {
    if (error instanceof RuntimeProtocolError) {
      sendJson(response, 400, {
        protocolVersion: RUNTIME_PROTOCOL_VERSION,
        outcome: "FAILED",
        error: {
          code: error.code,
          message: error.message,
        },
      });
      return;
    }

    sendJson(
      response,
      500,
      protocolFailure("Internal runtime handler failure."),
    );
    return;
  }

  sendJson(response, 200, result);
}

async function readLimitedBody(
  request: IncomingMessage,
  maxBytes: number,
): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;
    if (total > maxBytes) {
      throw new Error("Body too large.");
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

function protocolFailure(message: string) {
  return {
    protocolVersion: RUNTIME_PROTOCOL_VERSION,
    outcome: "FAILED" as const,
    error: {
      code: RUNTIME_PROTOCOL_ERROR_CODES.PROTOCOL_FAILURE,
      message,
    },
  };
}

function sendJson(
  response: ServerResponse,
  statusCode: number,
  body: object,
): void {
  const payload = JSON.stringify(body);
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
  });
  response.end(payload);
}
