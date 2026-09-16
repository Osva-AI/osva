import type { IncomingMessage } from "node:http";

import { OversizedBodyError } from "./errors.js";

export async function readLimitedNodeBody(
  request: IncomingMessage,
  maxBytes: number,
): Promise<Buffer> {
  const declared = contentLength(request.headers["content-length"]);
  if (declared !== undefined && declared > maxBytes) {
    request.resume();
    throw new OversizedBodyError();
  }

  const chunks: Buffer[] = [];
  let received = 0;

  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    received += buffer.length;
    if (received > maxBytes) {
      request.resume();
      throw new OversizedBodyError();
    }
    chunks.push(buffer);
  }

  return Buffer.concat(chunks, received);
}

export async function readLimitedFetchBody(
  response: Response,
  maxBytes: number,
): Promise<Buffer> {
  const declared = contentLength(response.headers.get("content-length"));
  if (declared !== undefined && declared > maxBytes) {
    await response.body?.cancel();
    throw new OversizedBodyError();
  }

  if (response.body === null) {
    return Buffer.alloc(0);
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    received += value.byteLength;
    if (received > maxBytes) {
      await reader.cancel();
      throw new OversizedBodyError();
    }
    chunks.push(value);
  }

  return Buffer.concat(chunks, received);
}

function contentLength(
  value: string | number | undefined | null,
): number | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  const parsed = typeof value === "number" ? value : Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return undefined;
  }

  return parsed;
}

export function isJsonContentType(value: string | undefined | null): boolean {
  if (value === undefined || value === null) {
    return false;
  }

  const mediaType = value.split(";", 1)[0]?.trim().toLowerCase();
  return mediaType === "application/json";
}
