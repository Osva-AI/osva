import { ConsoleApiError, type ConsoleApiErrorBody } from "./console-api";

export const MAX_ARTIFACT_PREVIEW_BYTES = 512 * 1024;

const TEXT_PREVIEW_MEDIA_TYPES = new Set([
  "text/markdown",
  "text/x-markdown",
  "text/plain",
  "text/csv",
  "text/tab-separated-values",
]);

const JSON_PREVIEW_MEDIA_TYPES = new Set(["application/json"]);

const UNSAFE_PREVIEW_MEDIA_TYPES = new Set([
  "text/html",
  "application/xhtml+xml",
  "image/svg+xml",
  "application/xml",
  "text/xml",
  "application/javascript",
  "text/javascript",
  "application/ecmascript",
  "application/pdf",
]);

export type ArtifactPreviewCapability =
  "text" | "json" | "too-large" | "unsupported";

export class ArtifactPreviewLimitError extends Error {
  constructor() {
    super("Artifact exceeds the preview size limit.");
    this.name = "ArtifactPreviewLimitError";
  }
}

export class ArtifactPreviewCancelledError extends Error {
  constructor() {
    super("Preview cancelled.");
    this.name = "ArtifactPreviewCancelledError";
  }
}

export function normalizeArtifactMediaType(mediaType: string): string {
  return mediaType.split(";")[0]?.trim().toLowerCase() ?? "";
}

export function classifyArtifactPreview(artifact: {
  readonly mediaType: string;
  readonly sizeBytes: number;
}): ArtifactPreviewCapability {
  const mediaType = normalizeArtifactMediaType(artifact.mediaType);
  if (
    UNSAFE_PREVIEW_MEDIA_TYPES.has(mediaType) ||
    (!TEXT_PREVIEW_MEDIA_TYPES.has(mediaType) &&
      !JSON_PREVIEW_MEDIA_TYPES.has(mediaType))
  ) {
    return "unsupported";
  }
  if (artifact.sizeBytes > MAX_ARTIFACT_PREVIEW_BYTES) {
    return "too-large";
  }
  return JSON_PREVIEW_MEDIA_TYPES.has(mediaType) ? "json" : "text";
}

export function describePreviewUnavailable(
  capability: ArtifactPreviewCapability,
): string | undefined {
  if (capability === "too-large") {
    return "This file is larger than the 512 KiB preview limit. Download the original instead.";
  }
  if (capability === "unsupported") {
    return "Preview is not available for this media type. Download the original instead.";
  }
  return undefined;
}

export function parseJsonPreview(
  text: string,
): { readonly ok: true; readonly value: unknown } | { readonly ok: false } {
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return { ok: false };
  }
}

export function artifactContentPath(artifactId: string): string {
  return `/api/v1/artifacts/${encodeURIComponent(artifactId)}/content`;
}

export async function readBoundedUtf8(
  body: ReadableStream<Uint8Array>,
  maxBytes: number,
  signal?: AbortSignal,
): Promise<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: false });
  let total = 0;
  let text = "";

  const onAbort = () => {
    void reader.cancel("preview cancelled");
  };
  signal?.addEventListener("abort", onAbort);

  try {
    if (signal?.aborted) {
      throw new ArtifactPreviewCancelledError();
    }

    for (;;) {
      if (signal?.aborted) {
        throw new ArtifactPreviewCancelledError();
      }

      const { done, value } = await reader.read();
      if (done) {
        text += decoder.decode();
        break;
      }
      if (value === undefined || value.byteLength === 0) {
        continue;
      }
      if (total + value.byteLength > maxBytes) {
        await reader.cancel("preview size limit");
        throw new ArtifactPreviewLimitError();
      }
      total += value.byteLength;
      text += decoder.decode(value, { stream: true });
    }

    return text;
  } catch (error) {
    if (
      signal?.aborted ||
      (error instanceof DOMException && error.name === "AbortError")
    ) {
      throw new ArtifactPreviewCancelledError();
    }
    throw error;
  } finally {
    signal?.removeEventListener("abort", onAbort);
    try {
      reader.releaseLock();
    } catch {
      // Reader may already be cancelled.
    }
  }
}

export async function fetchArtifactPreviewText(
  artifactId: string,
  options: {
    readonly maxBytes?: number;
    readonly signal?: AbortSignal;
  } = {},
): Promise<string> {
  const maxBytes = options.maxBytes ?? MAX_ARTIFACT_PREVIEW_BYTES;
  const response = await fetch(artifactContentPath(artifactId), {
    signal: options.signal,
  });

  if (!response.ok) {
    throw await previewErrorFromResponse(response);
  }

  if (response.body === null) {
    throw new ConsoleApiError(503, {
      error: "Artifact content is unavailable.",
      code: "unavailable",
    });
  }

  return readBoundedUtf8(response.body, maxBytes, options.signal);
}

export function previewErrorMessage(error: unknown): string {
  if (error instanceof ArtifactPreviewCancelledError) {
    return "Preview cancelled.";
  }
  if (error instanceof ArtifactPreviewLimitError) {
    return "Artifact exceeds the preview size limit.";
  }
  if (error instanceof ConsoleApiError) {
    if (error.status === 403) {
      return "You do not have permission to read this artifact.";
    }
    if (error.status === 404) {
      return "Artifact was not found.";
    }
    if (error.status === 503) {
      return "Artifact content is unavailable.";
    }
    return error.message;
  }
  if (error instanceof Error) {
    if (error.name === "AbortError") {
      return "Preview cancelled.";
    }
    return error.message;
  }
  return "Preview failed.";
}

async function previewErrorFromResponse(
  response: Response,
): Promise<ConsoleApiError> {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return new ConsoleApiError(response.status, {
      error: "Console returned a non-JSON error response.",
    });
  }

  const parsed =
    typeof body === "object" && body !== null
      ? (body as ConsoleApiErrorBody)
      : { error: "Request failed." };
  const headerRequestId = response.headers.get("x-osva-request-id")?.trim();
  return new ConsoleApiError(response.status, {
    ...parsed,
    requestId: parsed.requestId ?? headerRequestId,
  });
}
