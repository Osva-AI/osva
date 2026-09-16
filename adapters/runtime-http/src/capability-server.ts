import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";

import { RUNTIME_PROTOCOL_MAX_BODY_BYTES } from "@osva/runtime-protocol";

import { OversizedBodyError } from "./errors.js";
import { isJsonContentType, readLimitedNodeBody } from "./limited-body.js";

export interface RuntimeCapabilityHttpRequest {
  readonly method: string;
  readonly pathname: string;
  readonly authorization: string | undefined;
  readonly body: unknown;
}

export interface RuntimeCapabilityHttpResponse {
  readonly status: number;
  readonly body: unknown;
}

export type RuntimeCapabilityHttpHandler = (
  request: RuntimeCapabilityHttpRequest,
) => Promise<RuntimeCapabilityHttpResponse>;

export interface RuntimeCapabilityServer {
  readonly origin: string;
  readonly port: number;
  close(): Promise<void>;
}

export interface StartRuntimeCapabilityServerOptions {
  readonly host?: string;
  readonly port?: number;
  readonly handler: RuntimeCapabilityHttpHandler;
  readonly maxBodyBytes?: number;
}

export async function startRuntimeCapabilityServer(
  options: StartRuntimeCapabilityServerOptions,
): Promise<RuntimeCapabilityServer> {
  const host = options.host ?? "127.0.0.1";
  const maxBodyBytes = options.maxBodyBytes ?? RUNTIME_PROTOCOL_MAX_BODY_BYTES;
  const server = createServer((request, response) => {
    void handleCapabilityHttp(request, response, options.handler, maxBodyBytes);
  });

  await listen(server, host, options.port ?? 0);
  const address = server.address();
  if (address === null || typeof address === "string") {
    server.close();
    throw new Error("Runtime capability server failed to bind a TCP port.");
  }

  return {
    origin: `http://${host}:${String(address.port)}`,
    port: address.port,
    close: () => closeServer(server),
  };
}

async function handleCapabilityHttp(
  request: IncomingMessage,
  response: ServerResponse,
  handler: RuntimeCapabilityHttpHandler,
  maxBodyBytes: number,
): Promise<void> {
  const method = request.method ?? "GET";
  const pathname = pathnameOf(request.url ?? "/");

  if (method !== "POST") {
    writeJson(response, 405, { status: "method_not_allowed" });
    return;
  }

  if (!isJsonContentType(headerValue(request.headers["content-type"]))) {
    writeJson(response, 415, { status: "unsupported_media_type" });
    return;
  }

  let raw: Buffer;
  try {
    raw = await readLimitedNodeBody(request, maxBodyBytes);
  } catch (error) {
    if (error instanceof OversizedBodyError) {
      writeJson(response, 413, { status: "payload_too_large" });
      return;
    }
    writeJson(response, 400, { status: "invalid_request" });
    return;
  }

  let body: unknown;
  try {
    body = raw.length === 0 ? {} : JSON.parse(raw.toString("utf8"));
  } catch {
    writeJson(response, 400, { status: "invalid_json" });
    return;
  }

  const result = await handler({
    method,
    pathname,
    authorization: headerValue(request.headers.authorization),
    body,
  });
  writeJson(response, result.status, result.body);
}

function pathnameOf(url: string): string {
  const path = url.split("?", 1)[0] ?? "/";
  return path.length === 0 ? "/" : path;
}

function headerValue(
  value: string | readonly string[] | undefined,
): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value === "string") {
    return value;
  }
  return value[0];
}

function writeJson(
  response: ServerResponse,
  status: number,
  body: unknown,
): void {
  const payload = Buffer.from(JSON.stringify(body), "utf8");
  response.writeHead(status, {
    "content-type": "application/json",
    "content-length": String(payload.length),
  });
  response.end(payload);
}

function listen(server: Server, host: string, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      resolve();
    });
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}
