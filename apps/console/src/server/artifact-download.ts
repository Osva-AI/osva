import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

import type { ArtifactId } from "@osva-ai/contracts";

/**
 * Idle timeout for the streamed artifact body after upstream headers arrive.
 * The SDK download timeout (default 30s) applies only to waiting for those
 * headers and is not increased here.
 */
export const ARTIFACT_CONTENT_IDLE_TIMEOUT_MS = 60_000;

const UNSAFE_ARTIFACT_ID_PATTERN = /[\\/\0]|[.]{2}/;
const CONTROL_CHAR_PATTERN = /[\r\n\0]/;
const SAFE_MEDIA_TYPE_PATTERN =
  /^[a-zA-Z0-9!#$&^_.+-]+\/[a-zA-Z0-9!#$&^_.+-]+(?:\s*;\s*.+)?$/;
const DIGEST_HEADER_PATTERN = /^sha256:[0-9a-f]{64}$/i;
const CONTENT_LENGTH_PATTERN = /^\d+$/;

export function parseConsoleArtifactId(
  rawSegment: string,
): ArtifactId | undefined {
  let decoded: string;
  try {
    decoded = decodeURIComponent(rawSegment);
  } catch {
    return undefined;
  }

  if (decoded.length === 0) {
    return undefined;
  }

  if (
    CONTROL_CHAR_PATTERN.test(decoded) ||
    UNSAFE_ARTIFACT_ID_PATTERN.test(decoded)
  ) {
    return undefined;
  }

  return decoded as ArtifactId;
}

export function filenameFromContentDisposition(
  header: string | undefined,
): string {
  if (header === undefined || header.length === 0) {
    return "download";
  }

  const encoded = /filename\*\s*=\s*(?:UTF-8'')?([^;]+)/i.exec(header);
  if (encoded?.[1] !== undefined) {
    try {
      const value = decodeURIComponent(
        encoded[1].trim().replace(/^["']|["']$/g, ""),
      );
      if (value.length > 0) {
        return value;
      }
    } catch {
      // Fall through to filename= / default.
    }
  }

  const quoted = /filename\s*=\s*"([^"]*)"/i.exec(header);
  if (quoted?.[1] !== undefined && quoted[1].length > 0) {
    return quoted[1];
  }

  const unquoted = /filename\s*=\s*([^;]+)/i.exec(header);
  if (unquoted?.[1] !== undefined) {
    const value = unquoted[1].trim();
    if (value.length > 0) {
      return value;
    }
  }

  return "download";
}

export function contentDispositionAttachment(filename: string): string {
  const utf8Name = sanitizeAttachmentFilename(filename);
  const asciiFallback = utf8Name
    .replace(/[^\x20-\x7E]/g, "_")
    .replace(/"/g, "");
  return `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(utf8Name)}`;
}

export function sanitizeAttachmentFilename(filename: string): string {
  const firstLine = filename.split(/[\r\n]/)[0] ?? "";
  const cleaned = firstLine.replace(/\0/g, "").replace(/[/\\]/g, "_").trim();
  return cleaned.length > 0 ? cleaned : "download";
}

export function safeArtifactMediaType(value: string | undefined): string {
  if (value === undefined || value.length === 0 || /[\r\n\0]/.test(value)) {
    return "application/octet-stream";
  }

  const trimmed = value.trim();
  if (!SAFE_MEDIA_TYPE_PATTERN.test(trimmed) || trimmed.length > 255) {
    return "application/octet-stream";
  }

  return trimmed;
}

export function safeDigestHeader(
  value: string | undefined,
): string | undefined {
  if (value === undefined || !DIGEST_HEADER_PATTERN.test(value.trim())) {
    return undefined;
  }

  return value.trim();
}

export function safeContentLengthHeader(
  value: string | undefined,
): string | undefined {
  if (value === undefined || !CONTENT_LENGTH_PATTERN.test(value.trim())) {
    return undefined;
  }

  return value.trim();
}

export function buildArtifactDownloadHeaders(input: {
  readonly mediaType?: string;
  readonly contentLength?: string;
  readonly digest?: string;
  readonly filename?: string;
  readonly requestId?: string;
}): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": safeArtifactMediaType(input.mediaType),
    "Content-Disposition": contentDispositionAttachment(
      input.filename ?? "download",
    ),
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": "no-store",
  };

  const contentLength = safeContentLengthHeader(input.contentLength);
  if (contentLength !== undefined) {
    headers["Content-Length"] = contentLength;
  }

  const digest = safeDigestHeader(input.digest);
  if (digest !== undefined) {
    headers.Digest = digest;
  }

  if (input.requestId !== undefined && input.requestId.trim().length > 0) {
    headers["x-osva-request-id"] = input.requestId.trim();
  }

  return headers;
}

export async function pipeArtifactBodyToResponse(input: {
  readonly body: ReadableStream<Uint8Array>;
  readonly request: IncomingMessage;
  readonly response: ServerResponse;
  readonly idleTimeoutMs?: number;
}): Promise<void> {
  const idleTimeoutMs = input.idleTimeoutMs ?? ARTIFACT_CONTENT_IDLE_TIMEOUT_MS;
  const nodeStream = Readable.fromWeb(
    input.body as import("node:stream/web").ReadableStream<Uint8Array>,
  );
  const watchdog = createIdleWatchdog(idleTimeoutMs);

  const abortUpstream = () => {
    nodeStream.destroy();
  };
  input.request.once("close", abortUpstream);

  try {
    await pipeline(nodeStream, watchdog.transform, input.response);
  } catch {
    if (!input.response.writableEnded) {
      input.response.destroy();
    }
  } finally {
    watchdog.dispose();
    input.request.off("close", abortUpstream);
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
      transform.destroy(new Error("Artifact stream idle timeout."));
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
