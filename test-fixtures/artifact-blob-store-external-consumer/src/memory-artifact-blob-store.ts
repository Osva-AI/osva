import { createHash } from "node:crypto";
import { Readable } from "node:stream";

import type {
  ArtifactBlobReadHandle,
  ArtifactBlobStore,
  ArtifactBlobWriteInput,
  ArtifactBlobWriteResult,
  ArtifactStorageConfigRegistered,
  RegisteredArtifactBlobStoreModule,
} from "@osva-ai/contracts";

const blobs = new Map<string, Buffer>();

export class MemoryArtifactBlobStore implements ArtifactBlobStore {
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
    blobs.set(input.key, body);
    return { sizeBytes: body.length, digest };
  }

  async open(key: string): Promise<ArtifactBlobReadHandle> {
    const body = blobs.get(key);
    if (body === undefined) {
      throw new Error("ARTIFACT_NOT_FOUND");
    }
    return {
      sizeBytes: body.length,
      stream: Readable.from([body]),
    };
  }

  async delete(key: string): Promise<void> {
    blobs.delete(key);
  }
}

export function createArtifactBlobStore(
  _config: ArtifactStorageConfigRegistered,
): ArtifactBlobStore {
  return new MemoryArtifactBlobStore();
}

const moduleShape: RegisteredArtifactBlobStoreModule = {
  createArtifactBlobStore,
};

export default moduleShape;
