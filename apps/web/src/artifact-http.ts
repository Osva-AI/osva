import type { IncomingMessage, ServerResponse } from "node:http";
import { pipeline } from "node:stream/promises";
import type { ArtifactId, WorkspaceId } from "@osva/contracts";
import {
  artifactResourceSchema,
  listArtifactsQuerySchema,
} from "@osva/contracts/schemas";
import {
  DEFAULT_ARTIFACT_LIST_LIMIT,
  MAX_ARTIFACT_LIST_LIMIT,
  ArtifactPayloadTooLargeError,
  type Artifact,
  type ArtifactApplication,
} from "@osva/domain";

import {
  decodeArtifactListCursor,
  encodeArtifactListCursor,
} from "./artifact-cursor.js";
import { sendHttpError } from "./http-errors.js";
import { sendJson } from "./json.js";
import {
  parseArtifactMultipartUpload,
  rejectOversizedArtifactRequestBody,
} from "./artifact-multipart.js";

export async function handleArtifactRequest(
  request: IncomingMessage,
  response: ServerResponse,
  method: string,
  path: string,
  searchParams: URLSearchParams,
  artifacts: ArtifactApplication,
  maxBytes: number,
): Promise<boolean> {
  const route = matchArtifactRoute(path);
  if (route === undefined) {
    return false;
  }

  try {
    await dispatchArtifactRoute(
      request,
      response,
      method,
      route,
      searchParams,
      artifacts,
      maxBytes,
    );
  } catch (error) {
    sendHttpError(response, error);
  }

  return true;
}

type ArtifactRoute =
  | { readonly kind: "collection" }
  | { readonly kind: "item"; readonly artifactId: ArtifactId }
  | { readonly kind: "content"; readonly artifactId: ArtifactId };

async function dispatchArtifactRoute(
  request: IncomingMessage,
  response: ServerResponse,
  method: string,
  route: ArtifactRoute,
  searchParams: URLSearchParams,
  artifacts: ArtifactApplication,
  maxBytes: number,
): Promise<void> {
  if (route.kind === "collection") {
    if (method === "GET") {
      await handleListArtifacts(response, searchParams, artifacts);
      return;
    }

    if (method === "POST") {
      await handleCreateArtifact(request, response, artifacts, maxBytes);
      return;
    }

    sendJson(
      response,
      405,
      { status: "method_not_allowed" },
      { allow: "GET, POST" },
    );
    return;
  }

  if (route.kind === "item") {
    if (method !== "GET") {
      sendJson(
        response,
        405,
        { status: "method_not_allowed" },
        { allow: "GET" },
      );
      return;
    }

    const artifact = await artifacts.getArtifact.execute(route.artifactId);
    sendJson(response, 200, toArtifactResource(artifact));
    return;
  }

  if (method !== "GET") {
    sendJson(response, 405, { status: "method_not_allowed" }, { allow: "GET" });
    return;
  }

  const opened = await artifacts.openArtifactContent.execute(route.artifactId);
  response.statusCode = 200;
  response.setHeader("Content-Type", opened.artifact.mediaType);
  response.setHeader("Content-Length", String(opened.content.sizeBytes));
  response.setHeader(
    "Content-Disposition",
    contentDispositionAttachment(opened.artifact.name),
  );
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Digest", opened.artifact.digest);
  await pipeline(opened.content.stream, response);
}

async function handleListArtifacts(
  response: ServerResponse,
  searchParams: URLSearchParams,
  artifacts: ArtifactApplication,
): Promise<void> {
  const parsed = listArtifactsQuerySchema.safeParse(
    Object.fromEntries(searchParams.entries()),
  );
  if (!parsed.success) {
    sendJson(response, 400, { status: "invalid_request" });
    return;
  }

  let limit = DEFAULT_ARTIFACT_LIST_LIMIT;
  if (parsed.data.limit !== undefined) {
    limit = Number(parsed.data.limit);
    if (
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > MAX_ARTIFACT_LIST_LIMIT
    ) {
      sendJson(response, 400, { status: "invalid_request" });
      return;
    }
  }

  let cursor: { createdAt: Date; id: ArtifactId } | undefined;
  if (parsed.data.cursor !== undefined) {
    const decoded = decodeArtifactListCursor(parsed.data.cursor);
    if (decoded === null) {
      sendJson(response, 400, { status: "invalid_request" });
      return;
    }

    cursor = {
      createdAt: new Date(decoded.createdAt),
      id: decoded.id as ArtifactId,
    };
  }

  const page = await artifacts.listArtifacts.execute({
    workspaceId: parsed.data.workspaceId as WorkspaceId,
    runId: parsed.data.runId,
    runAttemptId: parsed.data.runAttemptId,
    limit,
    cursor,
  });

  sendJson(response, 200, toArtifactListResource(page));
}

async function handleCreateArtifact(
  request: IncomingMessage,
  response: ServerResponse,
  artifacts: ArtifactApplication,
  maxBytes: number,
): Promise<void> {
  const contentType = request.headers["content-type"];
  if (
    typeof contentType !== "string" ||
    !contentType.toLowerCase().startsWith("multipart/form-data")
  ) {
    sendJson(response, 400, { status: "invalid_request" });
    return;
  }

  const oversizeBody = rejectOversizedArtifactRequestBody(request, maxBytes);
  if (oversizeBody !== undefined) {
    sendHttpError(response, oversizeBody);
    return;
  }

  let uploadPromise: Promise<Artifact> | undefined;

  try {
    await parseArtifactMultipartUpload(request, contentType, maxBytes, {
      onUploadReady(fields, fileStream, fileMediaType) {
        const headerIdempotency = readHeader(request, "idempotency-key");
        const idempotencyKey = headerIdempotency ?? fields.idempotencyKey;
        const expectedDigest =
          readHeader(request, "x-expected-digest") ?? fields.expectedDigest;

        uploadPromise = artifacts.createArtifact.execute({
          workspaceId: fields.workspaceId as WorkspaceId,
          name: fields.name,
          mediaType:
            fields.mediaType ?? fileMediaType ?? "application/octet-stream",
          metadata: fields.metadata,
          content: fileStream,
          expectedDigest,
          idempotencyKey,
        });
      },
    });
  } catch (error) {
    if (error instanceof ArtifactPayloadTooLargeError) {
      sendHttpError(response, error);
      return;
    }

    sendJson(response, 400, { status: "invalid_request" });
    return;
  }

  if (uploadPromise === undefined) {
    sendJson(response, 400, { status: "invalid_request" });
    return;
  }

  let created: Artifact;
  try {
    created = await uploadPromise;
  } catch (error) {
    sendHttpError(response, error);
    return;
  }

  sendJson(response, 201, toArtifactResource(created));
}

function matchArtifactRoute(path: string): ArtifactRoute | undefined {
  if (path === "/v1/artifacts") {
    return { kind: "collection" };
  }

  const itemMatch = /^\/v1\/artifacts\/([^/]+)$/.exec(path);
  if (itemMatch !== null) {
    return { kind: "item", artifactId: itemMatch[1] as ArtifactId };
  }

  const contentMatch = /^\/v1\/artifacts\/([^/]+)\/content$/.exec(path);
  if (contentMatch !== null) {
    return { kind: "content", artifactId: contentMatch[1] as ArtifactId };
  }

  return undefined;
}

function toArtifactResource(artifact: Artifact) {
  const resource = {
    id: artifact.id,
    workspaceId: artifact.workspaceId,
    name: artifact.name,
    mediaType: artifact.mediaType,
    sizeBytes: artifact.sizeBytes,
    digest: artifact.digest,
    metadata: artifact.metadata,
    producer:
      artifact.producerRunId === undefined
        ? undefined
        : {
            runId: artifact.producerRunId,
            runAttemptId: artifact.producerRunAttemptId,
          },
    createdAt: artifact.createdAt.toISOString(),
  };

  return artifactResourceSchema.parse(resource);
}

function toArtifactListResource(page: {
  readonly artifacts: readonly Artifact[];
  readonly nextCursor?: { createdAt: Date; id: ArtifactId };
}): {
  items: ReturnType<typeof toArtifactResource>[];
  nextCursor?: string;
} {
  return {
    items: page.artifacts.map((artifact) => toArtifactResource(artifact)),
    nextCursor:
      page.nextCursor === undefined
        ? undefined
        : encodeArtifactListCursor(page.nextCursor),
  };
}

function contentDispositionAttachment(filename: string): string {
  const asciiFallback = filename
    .replace(/[^\x20-\x7E]/g, "_")
    .replace(/"/g, "");
  return `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

function readHeader(
  request: IncomingMessage,
  name: string,
): string | undefined {
  const value = request.headers[name];
  if (typeof value !== "string" || value.trim().length === 0) {
    return undefined;
  }

  return value.trim();
}
