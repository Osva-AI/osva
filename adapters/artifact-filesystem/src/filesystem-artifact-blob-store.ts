import { createHash, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

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

export interface FilesystemArtifactBlobStoreOptions {
  readonly rootDirectory: string;
}

export class FilesystemArtifactBlobStore implements ArtifactBlobStore {
  private readonly rootDirectory: string;

  constructor(options: FilesystemArtifactBlobStoreOptions) {
    this.rootDirectory = path.resolve(options.rootDirectory);
  }

  async write(input: ArtifactBlobWriteInput): Promise<ArtifactBlobWriteResult> {
    assertSafeBlobKey(input.key);
    const finalPath = resolveBlobPath(this.rootDirectory, input.key);
    await mkdir(path.dirname(finalPath), { recursive: true });

    const tempPath = `${finalPath}.${randomUUID()}.tmp`;
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

    try {
      await pipeline(
        input.content,
        limiter,
        createWriteStream(tempPath, {
          flags: "wx",
        }),
      );
    } catch (error) {
      await rm(tempPath, { force: true });
      throw error;
    }

    const digest = `${SHA256_INTEGRITY_PREFIX}${hash.digest("hex")}`;
    if (input.expectedDigest !== undefined && input.expectedDigest !== digest) {
      await rm(tempPath, { force: true });
      throw new ArtifactDigestMismatchError();
    }

    try {
      await rename(tempPath, finalPath);
    } catch (error) {
      await rm(tempPath, { force: true });
      throw error;
    }

    return { sizeBytes, digest };
  }

  async open(key: string): Promise<ArtifactBlobReadHandle> {
    assertSafeBlobKey(key);
    const filePath = resolveBlobPath(this.rootDirectory, key);
    let fileStat;
    try {
      fileStat = await stat(filePath);
    } catch (error) {
      if (isEnoent(error)) {
        throw new ArtifactBlobUnavailableError(
          artifactIdFromBlobStorageKey(key),
        );
      }
      throw error;
    }
    return {
      sizeBytes: fileStat.size,
      stream: createReadStream(filePath),
    };
  }

  async delete(key: string): Promise<void> {
    assertSafeBlobKey(key);
    const filePath = resolveBlobPath(this.rootDirectory, key);
    await rm(filePath, { force: true });
  }
}

export function createFilesystemArtifactBlobStore(
  options: FilesystemArtifactBlobStoreOptions,
): ArtifactBlobStore {
  return new FilesystemArtifactBlobStore(options);
}

function assertSafeBlobKey(key: string): void {
  if (typeof key !== "string" || key.length === 0) {
    throw new Error("Blob key is required.");
  }

  if (!SAFE_BLOB_KEY_PATTERN.test(key) || key.includes("..")) {
    throw new Error("Blob key contains unsupported characters.");
  }
}

function resolveBlobPath(rootDirectory: string, key: string): string {
  const resolvedRoot = path.resolve(rootDirectory);
  const resolvedPath = path.resolve(resolvedRoot, key);
  const relative = path.relative(resolvedRoot, resolvedPath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Blob key resolves outside artifact storage root.");
  }

  return resolvedPath;
}

export function readableFromBuffer(buffer: Buffer): Readable {
  return Readable.from(buffer);
}

function isEnoent(error: unknown): boolean {
  return (
    error !== null &&
    typeof error === "object" &&
    "code" in error &&
    (error as { code?: string }).code === "ENOENT"
  );
}
