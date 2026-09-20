import { createHash } from "node:crypto";
import { PassThrough, Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  S3Client,
  type S3ClientConfig,
} from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import { SHA256_INTEGRITY_PREFIX } from "@osva/contracts";
import {
  ArtifactBlobUnavailableError,
  ArtifactDigestMismatchError,
  ArtifactPayloadTooLargeError,
  artifactIdFromBlobStorageKey,
  type ArtifactBlobReadHandle,
  type ArtifactBlobStore,
  type ArtifactBlobWriteInput,
  type ArtifactBlobWriteResult,
} from "@osva/domain";

const SAFE_BLOB_KEY_PATTERN = /^[a-zA-Z0-9._/-]+$/;

export interface S3ArtifactBlobStoreOptions {
  readonly bucket: string;
  readonly region: string;
  readonly endpoint?: string;
  readonly accessKeyId?: string;
  readonly secretAccessKey?: string;
  readonly forcePathStyle?: boolean;
  readonly client?: S3Client;
}

export class S3ArtifactBlobStore implements ArtifactBlobStore {
  private readonly bucket: string;
  private readonly client: S3Client;

  constructor(options: S3ArtifactBlobStoreOptions) {
    this.bucket = options.bucket;
    this.client = options.client ?? new S3Client(buildClientConfig(options));
  }

  async write(input: ArtifactBlobWriteInput): Promise<ArtifactBlobWriteResult> {
    assertSafeBlobKey(input.key);
    const hash = createHash("sha256");
    let sizeBytes = 0;

    const limiter = new Transform({
      transform(chunk, _encoding, callback) {
        const buffer = chunk as Buffer;
        sizeBytes += buffer.length;
        if (sizeBytes > input.maxBytes) {
          callback(new ArtifactPayloadTooLargeError(input.maxBytes));
          return;
        }
        hash.update(buffer);
        callback(null, buffer);
      },
    });

    const body = new PassThrough();
    const upload = new Upload({
      client: this.client,
      params: {
        Bucket: this.bucket,
        Key: input.key,
        Body: body,
      },
      leavePartsOnError: false,
    });

    limiter.on("error", () => {
      body.destroy();
    });
    input.content.on("error", () => {
      body.destroy();
    });

    const uploadPromise = upload.done();

    try {
      await pipeline(input.content, limiter, body);
      await uploadPromise;
    } catch (error) {
      await Promise.allSettled([upload.abort(), uploadPromise]);
      body.destroy();
      await this.delete(input.key).catch(() => undefined);
      throw mapS3StorageError(error);
    }

    const digest = `${SHA256_INTEGRITY_PREFIX}${hash.digest("hex")}`;
    if (input.expectedDigest !== undefined && input.expectedDigest !== digest) {
      await this.delete(input.key).catch(() => undefined);
      throw new ArtifactDigestMismatchError();
    }

    return { sizeBytes, digest };
  }

  async open(key: string): Promise<ArtifactBlobReadHandle> {
    assertSafeBlobKey(key);
    let head;
    try {
      head = await this.client.send(
        new HeadObjectCommand({
          Bucket: this.bucket,
          Key: key,
        }),
      );
    } catch (error) {
      if (isS3NotFoundError(error)) {
        throw new ArtifactBlobUnavailableError(
          artifactIdFromBlobStorageKey(key),
        );
      }
      throw mapS3StorageError(error);
    }

    let response;
    try {
      response = await this.client.send(
        new GetObjectCommand({
          Bucket: this.bucket,
          Key: key,
        }),
      );
    } catch (error) {
      if (isS3NotFoundError(error)) {
        throw new ArtifactBlobUnavailableError(
          artifactIdFromBlobStorageKey(key),
        );
      }
      throw mapS3StorageError(error);
    }

    if (response.Body === undefined) {
      throw new ArtifactBlobUnavailableError(artifactIdFromBlobStorageKey(key));
    }

    const sizeBytes =
      typeof head.ContentLength === "number"
        ? head.ContentLength
        : typeof response.ContentLength === "number"
          ? response.ContentLength
          : 0;

    return {
      sizeBytes,
      stream: response.Body as Readable,
    };
  }

  async delete(key: string): Promise<void> {
    assertSafeBlobKey(key);
    try {
      await this.client.send(
        new DeleteObjectCommand({
          Bucket: this.bucket,
          Key: key,
        }),
      );
    } catch (error) {
      if (isS3NotFoundError(error)) {
        return;
      }
      throw mapS3StorageError(error);
    }
  }
}

export function createS3ArtifactBlobStore(
  options: S3ArtifactBlobStoreOptions,
): ArtifactBlobStore {
  return new S3ArtifactBlobStore(options);
}

function buildClientConfig(
  options: S3ArtifactBlobStoreOptions,
): S3ClientConfig {
  const config: S3ClientConfig = {
    region: options.region,
    forcePathStyle: options.forcePathStyle ?? false,
  };

  if (options.endpoint !== undefined) {
    config.endpoint = options.endpoint;
  }

  if (
    options.accessKeyId !== undefined &&
    options.secretAccessKey !== undefined
  ) {
    config.credentials = {
      accessKeyId: options.accessKeyId,
      secretAccessKey: options.secretAccessKey,
    };
  }

  return config;
}

function isS3NotFoundError(error: unknown): boolean {
  return (
    error !== null &&
    typeof error === "object" &&
    "name" in error &&
    (error as { name?: string }).name === "NotFound"
  );
}

function mapS3StorageError(error: unknown): Error {
  if (
    error instanceof ArtifactPayloadTooLargeError ||
    error instanceof ArtifactDigestMismatchError ||
    error instanceof ArtifactBlobUnavailableError
  ) {
    return error;
  }

  return new Error("Artifact storage operation failed.");
}

function assertSafeBlobKey(key: string): void {
  if (typeof key !== "string" || key.length === 0) {
    throw new Error("Blob key is required.");
  }

  if (!SAFE_BLOB_KEY_PATTERN.test(key) || key.includes("..")) {
    throw new Error("Blob key contains unsupported characters.");
  }
}
