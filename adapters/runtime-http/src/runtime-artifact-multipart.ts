import Busboy from "busboy";
import type { IncomingMessage } from "node:http";
import { PassThrough, Transform, type Readable } from "node:stream";
import type { JsonObject } from "@osva/contracts";
import { createRuntimeArtifactFormFieldsSchema } from "@osva/contracts/schemas";
import { ArtifactPayloadTooLargeError } from "@osva/domain";

export interface ParsedRuntimeArtifactMultipartFields {
  readonly executionId: string;
  readonly name: string;
  readonly mediaType?: string;
  readonly metadata?: JsonObject;
  readonly expectedDigest?: string;
  readonly idempotencyKey?: string;
}

export interface RuntimeArtifactMultipartUploadHooks {
  onUploadReady(
    fields: ParsedRuntimeArtifactMultipartFields,
    fileStream: Readable,
    fileMediaType?: string,
  ): void;
}

export const RUNTIME_ARTIFACT_MULTIPART_OVERHEAD_BYTES = 1_048_576;

export function rejectOversizedRuntimeArtifactRequestBody(
  request: IncomingMessage,
  maxBytes: number,
): ArtifactPayloadTooLargeError | undefined {
  const raw = request.headers["content-length"];
  if (typeof raw !== "string") {
    return undefined;
  }

  const contentLength = Number(raw);
  if (!Number.isFinite(contentLength) || contentLength < 0) {
    return undefined;
  }

  if (contentLength > maxBytes + RUNTIME_ARTIFACT_MULTIPART_OVERHEAD_BYTES) {
    return new ArtifactPayloadTooLargeError(maxBytes);
  }

  return undefined;
}

export async function parseRuntimeArtifactMultipartUpload(
  request: IncomingMessage,
  contentType: string,
  maxBytes: number,
  hooks: RuntimeArtifactMultipartUploadHooks,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const busboy = Busboy({
      headers: { "content-type": contentType },
      limits: {
        files: 1,
        fields: 16,
        fieldSize: 32 * 1024,
      },
    });

    const rawFields: Record<string, string> = {};
    let fileBytes = 0;
    let fileMediaType: string | undefined;
    let sawFile = false;
    let rejected = false;
    let uploadStarted = false;
    let fileStream: PassThrough | undefined;

    const fail = (error: unknown): void => {
      if (rejected) {
        return;
      }
      rejected = true;
      fileStream?.destroy(
        error instanceof Error ? error : new Error(String(error)),
      );
      request.unpipe(busboy);
      busboy.removeAllListeners();
      reject(error);
    };

    const onAborted = (): void => {
      fail(new Error("Client disconnected during artifact upload."));
    };

    request.once("aborted", onAborted);

    const tryStartUpload = (): void => {
      if (uploadStarted || rejected || fileStream === undefined) {
        return;
      }

      if (rawFields.executionId === undefined || rawFields.name === undefined) {
        return;
      }

      let metadata: JsonObject | undefined;
      if (rawFields.metadata !== undefined) {
        try {
          const parsed = JSON.parse(rawFields.metadata) as unknown;
          if (
            typeof parsed !== "object" ||
            parsed === null ||
            Array.isArray(parsed)
          ) {
            fail(new Error("Artifact metadata must be a JSON object."));
            return;
          }
          metadata = parsed as JsonObject;
        } catch {
          fail(new Error("Artifact metadata must be valid JSON."));
          return;
        }
      }

      const validated = createRuntimeArtifactFormFieldsSchema.safeParse({
        executionId: rawFields.executionId,
        name: rawFields.name,
        mediaType: rawFields.mediaType,
        metadata,
        expectedDigest: rawFields.expectedDigest,
        idempotencyKey: rawFields.idempotencyKey,
      });

      if (!validated.success) {
        fail(new Error("Invalid artifact multipart fields."));
        return;
      }

      uploadStarted = true;
      hooks.onUploadReady(validated.data, fileStream, fileMediaType);
    };

    busboy.on("field", (name, value) => {
      rawFields[name] = value;
      tryStartUpload();
    });

    busboy.on("file", (_name, stream, info) => {
      if (sawFile) {
        fail(new Error("Multiple files are not supported."));
        stream.resume();
        return;
      }

      if (rawFields.executionId === undefined || rawFields.name === undefined) {
        fail(
          new Error(
            "Artifact multipart fields executionId and name must precede file content.",
          ),
        );
        stream.resume();
        return;
      }

      sawFile = true;
      fileMediaType = info.mimeType;
      fileStream = new PassThrough();

      const limiter = new Transform({
        transform(chunk: Buffer, _encoding, callback) {
          fileBytes += chunk.length;
          if (fileBytes > maxBytes) {
            stream.resume();
            callback(new ArtifactPayloadTooLargeError(maxBytes));
            return;
          }
          callback(null, chunk);
        },
      });

      limiter.on("error", (error) => {
        fail(error);
      });

      stream.on("error", (error) => {
        fail(error);
      });

      stream.pipe(limiter).pipe(fileStream, { end: true });
      tryStartUpload();
    });

    busboy.on("error", (error) => {
      fail(error);
    });

    busboy.on("finish", () => {
      request.off("aborted", onAborted);
      if (rejected) {
        return;
      }

      if (!sawFile || fileBytes === 0) {
        fail(new Error("Artifact file content is required."));
        return;
      }

      if (!uploadStarted) {
        fail(new Error("Invalid artifact multipart fields."));
        return;
      }

      resolve();
    });

    request.pipe(busboy);
  });
}
