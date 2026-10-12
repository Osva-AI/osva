import type { IncomingMessage } from "node:http";

import { OSVA_DEFAULT_JSON_BODY_MAX_BYTES } from "@osva-ai/contracts";

export class ConsoleRequestBodyTooLargeError extends Error {
  constructor() {
    super("Request body exceeds the allowed size.");
    this.name = "ConsoleRequestBodyTooLargeError";
  }
}

export class ConsoleInvalidJsonBodyError extends Error {
  constructor() {
    super("Request body must be valid JSON.");
    this.name = "ConsoleInvalidJsonBodyError";
  }
}

export async function readJsonBody(
  request: IncomingMessage,
  maxBytes: number = OSVA_DEFAULT_JSON_BODY_MAX_BYTES,
): Promise<unknown> {
  const chunks: Buffer[] = [];
  let totalBytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += buffer.length;
    if (totalBytes > maxBytes) {
      throw new ConsoleRequestBodyTooLargeError();
    }
    chunks.push(buffer);
  }
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (raw.length === 0) {
    return {};
  }
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new ConsoleInvalidJsonBodyError();
  }
}
