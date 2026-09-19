import type { IncomingMessage, ServerResponse } from "node:http";

export interface ReadJsonBodyOptions {
  readonly maxBytes?: number;
}

export async function readJsonBody(
  request: IncomingMessage,
  options: ReadJsonBodyOptions = {},
): Promise<unknown> {
  const chunks: Buffer[] = [];
  let totalBytes = 0;
  for await (const chunk of request) {
    const buffer = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
    totalBytes += buffer.length;
    if (options.maxBytes !== undefined && totalBytes > options.maxBytes) {
      throw new RequestBodyTooLargeError();
    }
    chunks.push(buffer);
  }

  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (raw.length === 0) {
    throw new InvalidJsonBodyError();
  }

  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new InvalidJsonBodyError();
  }
}

export function sendJson(
  response: ServerResponse,
  statusCode: number,
  body: object,
  headers: Readonly<Record<string, string>> = {},
): void {
  const payload = JSON.stringify(body);
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
    ...headers,
  });
  response.end(payload);
}

export class InvalidJsonBodyError extends Error {
  constructor() {
    super("Request body must be valid JSON.");
    this.name = "InvalidJsonBodyError";
  }
}

export class RequestBodyTooLargeError extends Error {
  constructor() {
    super("Request body exceeds the allowed size.");
    this.name = "RequestBodyTooLargeError";
  }
}
