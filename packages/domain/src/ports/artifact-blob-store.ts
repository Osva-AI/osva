import type { Readable } from "node:stream";

export interface ArtifactBlobWriteInput {
  readonly key: string;
  readonly content: Readable;
  readonly maxBytes: number;
  readonly expectedDigest?: string;
}

export interface ArtifactBlobWriteResult {
  readonly sizeBytes: number;
  readonly digest: string;
}

export interface ArtifactBlobReadHandle {
  readonly sizeBytes: number;
  readonly stream: Readable;
}

export interface ArtifactBlobStore {
  write(input: ArtifactBlobWriteInput): Promise<ArtifactBlobWriteResult>;
  open(key: string): Promise<ArtifactBlobReadHandle>;
  delete(key: string): Promise<void>;
}
