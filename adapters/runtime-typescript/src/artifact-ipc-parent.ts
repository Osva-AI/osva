import type { ChildProcess } from "node:child_process";
import { PassThrough } from "node:stream";

import type { ExecutionRequest } from "@osva/contracts";
import { ARTIFACT_ERROR_CODES } from "@osva/contracts";

import { TRUSTED_RUNTIME_ARTIFACT_IPC_CHUNK_BYTES } from "./constants.js";
import { sanitizePublicErrorMessage } from "./public-error.js";
import type {
  ArtifactCreateChunkMessage,
  ArtifactCreateRequestMessage,
  ArtifactGetRequestMessage,
  ArtifactOpenRequestMessage,
  RuntimeArtifactViewMessage,
} from "./protocol.js";

export interface TrustedRuntimeArtifactExecution {
  readonly workspaceId: ExecutionRequest["workspaceId"];
  readonly runId: ExecutionRequest["runId"];
  readonly runAttemptId: ExecutionRequest["runAttemptId"];
}

export interface TrustedRuntimeArtifactApplication {
  readonly getRuntimeArtifact: {
    execute(
      artifactId: string,
      execution: TrustedRuntimeArtifactExecution,
    ): Promise<RuntimeArtifactViewMessage>;
  };
  readonly createRuntimeArtifact: {
    execute(command: {
      readonly execution: TrustedRuntimeArtifactExecution;
      readonly name: string;
      readonly mediaType: string;
      readonly metadata?: RuntimeArtifactViewMessage["metadata"];
      readonly content: PassThrough;
      readonly idempotencyKey?: string;
      readonly expectedDigest?: string;
    }): Promise<RuntimeArtifactViewMessage>;
  };
  readonly openRuntimeArtifactContent: {
    execute(
      artifactId: string,
      execution: TrustedRuntimeArtifactExecution,
    ): Promise<{
      readonly artifact: RuntimeArtifactViewMessage;
      readonly content: {
        readonly sizeBytes: number;
        readonly stream: AsyncIterable<Uint8Array | Buffer>;
      };
    }>;
  };
}

export class ArtifactCreateIpcSessions {
  private readonly sessions = new Map<
    string,
    {
      readonly stream: PassThrough;
      readonly message: ArtifactCreateRequestMessage;
    }
  >();

  start(
    message: ArtifactCreateRequestMessage,
    onEnd: (session: {
      readonly stream: PassThrough;
      readonly message: ArtifactCreateRequestMessage;
    }) => void,
  ): void {
    const stream = new PassThrough();
    this.sessions.set(message.callId, { message, stream });
    onEnd({ message, stream });
  }

  writeChunk(message: ArtifactCreateChunkMessage): boolean {
    const session = this.sessions.get(message.callId);
    if (session === undefined) {
      return false;
    }
    session.stream.write(Buffer.from(message.chunk, "base64"));
    return true;
  }

  end(callId: string): void {
    const session = this.sessions.get(callId);
    if (session === undefined) {
      return;
    }
    this.sessions.delete(callId);
    session.stream.end();
  }
}

export async function handleArtifactGetIpc(options: {
  readonly child: ChildProcess;
  readonly message: ArtifactGetRequestMessage;
  readonly artifacts: TrustedRuntimeArtifactApplication | undefined;
  readonly execution: ExecutionRequest;
  readonly logger: { error(event: string, error: unknown): void } | undefined;
  readonly isSettled: () => boolean;
}): Promise<void> {
  const { child, message, artifacts, execution, logger, isSettled } = options;

  const sendFailure = (code: string, errorMessage: string) => {
    if (isSettled() || child.killed || child.exitCode !== null) {
      return;
    }

    child.send({
      v: 1,
      type: "artifact.get.failed",
      callId: message.callId,
      error: {
        code,
        message: sanitizePublicErrorMessage(
          errorMessage,
          "Artifact get failed.",
        ),
      },
    });
  };

  if (artifacts === undefined) {
    sendFailure(
      ARTIFACT_ERROR_CODES.ARTIFACT_UNAVAILABLE,
      "Artifact capability is unavailable.",
    );
    return;
  }

  try {
    const artifact = await artifacts.getRuntimeArtifact.execute(
      message.artifactId,
      executionIdentity(execution),
    );

    if (isSettled() || child.killed || child.exitCode !== null) {
      return;
    }

    child.send({
      v: 1,
      type: "artifact.get.succeeded",
      callId: message.callId,
      artifact,
    });
  } catch (error) {
    logger?.error("runtime.artifact_get_failed", error);
    const mapped = mapArtifactFailure(error);
    sendFailure(mapped.code, mapped.message);
  }
}

export function handleArtifactCreateRequestIpc(options: {
  readonly child: ChildProcess;
  readonly message: ArtifactCreateRequestMessage;
  readonly sessions: ArtifactCreateIpcSessions;
  readonly artifacts: TrustedRuntimeArtifactApplication | undefined;
  readonly execution: ExecutionRequest;
  readonly logger: { error(event: string, error: unknown): void } | undefined;
  readonly isSettled: () => boolean;
}): void {
  const sendFailure = (code: string, errorMessage: string) => {
    if (
      options.isSettled() ||
      options.child.killed ||
      options.child.exitCode !== null
    ) {
      return;
    }

    options.child.send({
      v: 1,
      type: "artifact.create.failed",
      callId: options.message.callId,
      error: {
        code,
        message: sanitizePublicErrorMessage(
          errorMessage,
          "Artifact create failed.",
        ),
      },
    });
  };

  if (options.artifacts === undefined) {
    sendFailure(
      ARTIFACT_ERROR_CODES.ARTIFACT_UNAVAILABLE,
      "Artifact capability is unavailable.",
    );
    return;
  }

  options.sessions.start(options.message, (session) => {
    void (async () => {
      try {
        const artifact = await options.artifacts!.createRuntimeArtifact.execute(
          {
            execution: executionIdentity(options.execution),
            name: session.message.name,
            mediaType: session.message.mediaType ?? "application/octet-stream",
            metadata: session.message.metadata,
            content: session.stream,
            idempotencyKey: session.message.idempotencyKey,
            expectedDigest: session.message.expectedDigest,
          },
        );

        if (
          options.isSettled() ||
          options.child.killed ||
          options.child.exitCode !== null
        ) {
          return;
        }

        options.child.send({
          v: 1,
          type: "artifact.create.succeeded",
          callId: options.message.callId,
          artifact,
        });
      } catch (error) {
        options.logger?.error("runtime.artifact_create_failed", error);
        const mapped = mapArtifactFailure(error);
        sendFailure(mapped.code, mapped.message);
      }
    })();
  });
}

export function handleArtifactCreateEndIpc(options: {
  readonly sessions: ArtifactCreateIpcSessions;
  readonly callId: string;
}): void {
  options.sessions.end(options.callId);
}

export async function handleArtifactOpenIpc(options: {
  readonly child: ChildProcess;
  readonly message: ArtifactOpenRequestMessage;
  readonly artifacts: TrustedRuntimeArtifactApplication | undefined;
  readonly execution: ExecutionRequest;
  readonly logger: { error(event: string, error: unknown): void } | undefined;
  readonly isSettled: () => boolean;
}): Promise<void> {
  const { child, message, artifacts, execution, logger, isSettled } = options;

  const sendFailure = (code: string, errorMessage: string) => {
    if (isSettled() || child.killed || child.exitCode !== null) {
      return;
    }

    child.send({
      v: 1,
      type: "artifact.open.failed",
      callId: message.callId,
      error: {
        code,
        message: sanitizePublicErrorMessage(
          errorMessage,
          "Artifact open failed.",
        ),
      },
    });
  };

  if (artifacts === undefined) {
    sendFailure(
      ARTIFACT_ERROR_CODES.ARTIFACT_UNAVAILABLE,
      "Artifact capability is unavailable.",
    );
    return;
  }

  try {
    const opened = await artifacts.openRuntimeArtifactContent.execute(
      message.artifactId,
      executionIdentity(execution),
    );

    if (isSettled() || child.killed || child.exitCode !== null) {
      return;
    }

    child.send({
      v: 1,
      type: "artifact.open.meta",
      callId: message.callId,
      artifact: opened.artifact,
    });

    for await (const chunk of opened.content.stream) {
      if (isSettled() || child.killed || child.exitCode !== null) {
        return;
      }

      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      for (
        let offset = 0;
        offset < buffer.length;
        offset += TRUSTED_RUNTIME_ARTIFACT_IPC_CHUNK_BYTES
      ) {
        const slice = buffer.subarray(
          offset,
          offset + TRUSTED_RUNTIME_ARTIFACT_IPC_CHUNK_BYTES,
        );
        child.send({
          v: 1,
          type: "artifact.open.chunk",
          callId: message.callId,
          chunk: slice.toString("base64"),
        });
      }
    }

    child.send({
      v: 1,
      type: "artifact.open.end",
      callId: message.callId,
    });
  } catch (error) {
    logger?.error("runtime.artifact_open_failed", error);
    const mapped = mapArtifactFailure(error);
    sendFailure(mapped.code, mapped.message);
  }
}

function executionIdentity(
  execution: ExecutionRequest,
): TrustedRuntimeArtifactExecution {
  return {
    workspaceId: execution.workspaceId,
    runId: execution.runId,
    runAttemptId: execution.runAttemptId,
  };
}

function mapArtifactFailure(error: unknown): {
  readonly code: string;
  readonly message: string;
} {
  if (
    error !== null &&
    typeof error === "object" &&
    "code" in error &&
    typeof error.code === "string" &&
    error.code.length > 0
  ) {
    const message =
      error instanceof Error ? error.message : "Artifact operation failed.";
    return { code: error.code, message };
  }

  if (error instanceof Error) {
    if (error.name === "ArtifactNotFoundError") {
      return {
        code: ARTIFACT_ERROR_CODES.ARTIFACT_NOT_FOUND,
        message: error.message,
      };
    }
    if (error.name === "ArtifactWorkspaceMismatchError") {
      return {
        code: ARTIFACT_ERROR_CODES.ARTIFACT_WORKSPACE_MISMATCH,
        message: error.message,
      };
    }
    if (error.name === "ArtifactIdempotencyConflictError") {
      return {
        code: ARTIFACT_ERROR_CODES.ARTIFACT_IDEMPOTENCY_CONFLICT,
        message: error.message,
      };
    }
    if (error.name === "ArtifactPayloadTooLargeError") {
      return {
        code: ARTIFACT_ERROR_CODES.ARTIFACT_PAYLOAD_TOO_LARGE,
        message: error.message,
      };
    }
    if (error.name === "ArtifactDigestMismatchError") {
      return {
        code: ARTIFACT_ERROR_CODES.ARTIFACT_DIGEST_MISMATCH,
        message: error.message,
      };
    }
    if (error.name === "ArtifactBlobUnavailableError") {
      return {
        code: ARTIFACT_ERROR_CODES.ARTIFACT_UNAVAILABLE,
        message: error.message,
      };
    }
  }

  return {
    code: ARTIFACT_ERROR_CODES.ARTIFACT_UNAVAILABLE,
    message: "Artifact operation failed.",
  };
}
