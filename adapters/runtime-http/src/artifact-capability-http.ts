import type { IncomingMessage, ServerResponse } from "node:http";
import { pipeline } from "node:stream/promises";

import type { ArtifactId, ExecutionRequest } from "@osva/contracts";
import { ARTIFACT_ERROR_CODES } from "@osva/contracts";
import {
  type RuntimeArtifactApplication,
  type RuntimeArtifactView,
  ArtifactPayloadTooLargeError,
} from "@osva/domain";
import {
  RUNTIME_CAPABILITY_PATHS,
  RUNTIME_PROTOCOL_VERSION,
} from "@osva/runtime-protocol";

import { mapArtifactDomainError } from "./artifact-errors.js";
import type { RuntimeCapabilityBridge } from "./capability-bridge.js";
import { sanitizePublicErrorMessage } from "./public-error.js";
import {
  parseRuntimeArtifactMultipartUpload,
  rejectOversizedRuntimeArtifactRequestBody,
} from "./runtime-artifact-multipart.js";

export interface ArtifactCapabilityHttpLogger {
  info(event: string, fields?: Readonly<Record<string, unknown>>): void;
  error(event: string, error: unknown): void;
}

export interface ArtifactCapabilityHttpDeps {
  readonly artifacts: RuntimeArtifactApplication;
  readonly maxBytes: number;
  readonly logger?: ArtifactCapabilityHttpLogger;
}

export function createArtifactCapabilityRawHandler(
  bridge: RuntimeCapabilityBridge,
  deps: ArtifactCapabilityHttpDeps,
): (request: IncomingMessage, response: ServerResponse) => Promise<boolean> {
  return async (request, response) => {
    const pathname = pathnameOf(request.url ?? "/");
    if (pathname === RUNTIME_CAPABILITY_PATHS.artifactCreate) {
      if (request.method !== "POST") {
        writeJson(response, 405, { status: "method_not_allowed" });
        return true;
      }
      await handleArtifactCreate(request, response, bridge, deps);
      return true;
    }

    if (pathname === RUNTIME_CAPABILITY_PATHS.artifactContent) {
      if (request.method !== "GET") {
        writeJson(response, 405, { status: "method_not_allowed" });
        return true;
      }
      await handleArtifactContent(request, response, bridge, deps);
      return true;
    }

    return false;
  };
}

async function handleArtifactCreate(
  request: IncomingMessage,
  response: ServerResponse,
  bridge: RuntimeCapabilityBridge,
  deps: ArtifactCapabilityHttpDeps,
): Promise<void> {
  const contentType = request.headers["content-type"];
  if (
    typeof contentType !== "string" ||
    !contentType.toLowerCase().startsWith("multipart/form-data")
  ) {
    writeJson(response, 400, protocolInvalidBody());
    return;
  }

  const oversizeBody = rejectOversizedRuntimeArtifactRequestBody(
    request,
    deps.maxBytes,
  );
  if (oversizeBody !== undefined) {
    writeArtifactFailure(
      response,
      "",
      mapArtifactDomainError(oversizeBody),
      413,
    );
    return;
  }

  let executionId = "";
  let uploadPromise: Promise<RuntimeArtifactView> | undefined;

  try {
    await parseRuntimeArtifactMultipartUpload(
      request,
      contentType,
      deps.maxBytes,
      {
        onUploadReady(fields, fileStream, fileMediaType) {
          executionId = fields.executionId;
          uploadPromise = (async () => {
            const authorized = await bridge.authorizeCapabilityRequest(
              headerValue(request.headers.authorization),
              fields.executionId,
            );
            if (authorized.error !== undefined) {
              throw httpErrorFromCapabilityResponse(authorized.error);
            }

            const execution = authorized.execution;
            return deps.artifacts.createRuntimeArtifact.execute({
              execution: {
                workspaceId: execution.workspaceId,
                runId: execution.runId,
                runAttemptId: execution.runAttemptId,
              },
              name: fields.name,
              mediaType:
                fields.mediaType ?? fileMediaType ?? "application/octet-stream",
              metadata: fields.metadata,
              content: fileStream,
              expectedDigest: fields.expectedDigest,
              idempotencyKey: fields.idempotencyKey,
            });
          })();
        },
      },
    );
  } catch (error) {
    if (error instanceof ArtifactPayloadTooLargeError) {
      writeArtifactFailure(
        response,
        executionId,
        mapArtifactDomainError(error),
        413,
      );
      return;
    }

    writeArtifactFailure(
      response,
      executionId,
      {
        code: ARTIFACT_ERROR_CODES.ARTIFACT_INVALID_REQUEST,
        message:
          error instanceof Error
            ? error.message
            : "Artifact upload request is invalid.",
      },
      400,
    );
    return;
  }

  if (uploadPromise === undefined) {
    writeArtifactFailure(
      response,
      executionId,
      {
        code: ARTIFACT_ERROR_CODES.ARTIFACT_INVALID_REQUEST,
        message: "Artifact upload request is invalid.",
      },
      400,
    );
    return;
  }

  try {
    const artifact = await uploadPromise;
    deps.logger?.info("runtime.capability.artifact_create_succeeded", {
      executionId,
      artifactId: artifact.id,
    });
    writeJson(response, 200, {
      protocolVersion: RUNTIME_PROTOCOL_VERSION,
      executionId,
      outcome: "SUCCEEDED",
      artifact,
    });
  } catch (error) {
    if (isHttpErrorResponse(error)) {
      writeJson(response, error.status, error.body);
      return;
    }

    deps.logger?.error("runtime.capability.artifact_create_failed", error);
    const mapped = mapArtifactDomainError(error);
    writeArtifactFailure(response, executionId, mapped);
  }
}

async function handleArtifactContent(
  request: IncomingMessage,
  response: ServerResponse,
  bridge: RuntimeCapabilityBridge,
  deps: ArtifactCapabilityHttpDeps,
): Promise<void> {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  const executionId = url.searchParams.get("executionId")?.trim() ?? "";
  const artifactId = url.searchParams.get("artifactId")?.trim() ?? "";

  if (executionId.length === 0 || artifactId.length === 0) {
    writeJson(response, 400, protocolInvalidBody());
    return;
  }

  try {
    const opened = await createAfterAuthorize(
      bridge,
      request,
      executionId,
      async (execution) => {
        const opened = await deps.artifacts.openRuntimeArtifactContent.execute(
          artifactId as ArtifactId,
          {
            workspaceId: execution.workspaceId,
            runId: execution.runId,
            runAttemptId: execution.runAttemptId,
          },
        );
        return opened;
      },
    );

    response.statusCode = 200;
    response.setHeader("Content-Type", opened.artifact.mediaType);
    response.setHeader("Content-Length", String(opened.content.sizeBytes));
    response.setHeader("Digest", opened.artifact.digest);
    response.setHeader("X-Content-Type-Options", "nosniff");
    await pipeline(opened.content.stream, response);
  } catch (error) {
    if (isHttpErrorResponse(error)) {
      writeJson(response, error.status, error.body);
      return;
    }

    deps.logger?.error("runtime.capability.artifact_content_failed", error);
    const mapped = mapArtifactDomainError(error);
    writeArtifactFailure(response, executionId, mapped);
  }
}

async function createAfterAuthorize<T>(
  bridge: RuntimeCapabilityBridge,
  request: IncomingMessage,
  executionId: string,
  action: (execution: ExecutionRequest) => Promise<T>,
): Promise<T> {
  const authorized = await bridge.authorizeCapabilityRequest(
    headerValue(request.headers.authorization),
    executionId,
  );
  if (authorized.error !== undefined) {
    throw httpErrorFromCapabilityResponse(authorized.error);
  }

  return action(authorized.execution!);
}

function httpErrorFromCapabilityResponse(error: {
  readonly status: number;
  readonly body: unknown;
}): { readonly status: number; readonly body: unknown } {
  return { status: error.status, body: error.body };
}

function isHttpErrorResponse(
  value: unknown,
): value is { readonly status: number; readonly body: unknown } {
  return (
    value !== null &&
    typeof value === "object" &&
    "status" in value &&
    typeof (value as { status: unknown }).status === "number" &&
    "body" in value
  );
}

function writeArtifactFailure(
  response: ServerResponse,
  executionId: string,
  mapped: { readonly code: string; readonly message: string },
  status = 200,
): void {
  writeJson(response, status, {
    protocolVersion: RUNTIME_PROTOCOL_VERSION,
    executionId,
    outcome: "FAILED",
    error: {
      code: mapped.code,
      message: sanitizePublicErrorMessage(
        mapped.message,
        "Artifact capability failed.",
      ),
    },
  });
}

function protocolInvalidBody(): unknown {
  return {
    protocolVersion: RUNTIME_PROTOCOL_VERSION,
    outcome: "FAILED",
    error: {
      code: ARTIFACT_ERROR_CODES.ARTIFACT_INVALID_REQUEST,
      message: "Capability request is invalid.",
    },
  };
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
