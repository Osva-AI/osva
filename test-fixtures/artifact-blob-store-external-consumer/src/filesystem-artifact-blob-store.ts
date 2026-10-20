import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";

import type {
  ArtifactBlobReadHandle,
  ArtifactBlobStore,
  ArtifactBlobWriteInput,
  ArtifactBlobWriteResult,
  ArtifactStorageConfigRegistered,
  RegisteredArtifactBlobStoreModule,
} from "@osva-ai/contracts";

function rootFromEnv(): string {
  const root = process.env.OSVA_ARTIFACT_FILESYSTEM_ROOT?.trim();
  if (root === undefined || root.length === 0) {
    throw new Error("OSVA_ARTIFACT_FILESYSTEM_ROOT is required");
  }
  return root;
}

function objectPath(root: string, key: string): string {
  const segments = key.split("/").filter((segment) => segment.length > 0);
  if (segments.some((segment) => segment === "..")) {
    throw new Error("Invalid artifact blob key");
  }
  return path.join(root, ...segments);
}

export class FilesystemArtifactBlobStore implements ArtifactBlobStore {
  constructor(private readonly rootDirectory: string) {}

  async write(input: ArtifactBlobWriteInput): Promise<ArtifactBlobWriteResult> {
    const chunks: Buffer[] = [];
    for await (const chunk of input.content) {
      chunks.push(Buffer.from(chunk));
    }
    const body = Buffer.concat(chunks);
    if (body.length > input.maxBytes) {
      throw new Error("ARTIFACT_PAYLOAD_TOO_LARGE");
    }
    const digest = `sha256:${createHash("sha256").update(body).digest("hex")}`;
    const target = objectPath(this.rootDirectory, input.key);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, body);
    return { sizeBytes: body.length, digest };
  }

  async open(key: string): Promise<ArtifactBlobReadHandle> {
    const target = objectPath(this.rootDirectory, key);
    try {
      const body = await fs.readFile(target);
      return {
        sizeBytes: body.length,
        stream: Readable.from([body]),
      };
    } catch {
      throw new Error("ARTIFACT_NOT_FOUND");
    }
  }

  async delete(key: string): Promise<void> {
    const target = objectPath(this.rootDirectory, key);
    await fs.rm(target, { force: true });
  }
}

export function createArtifactBlobStore(
  _config: ArtifactStorageConfigRegistered,
): ArtifactBlobStore {
  return new FilesystemArtifactBlobStore(rootFromEnv());
}

const moduleShape: RegisteredArtifactBlobStoreModule = {
  createArtifactBlobStore,
};

export default moduleShape;
