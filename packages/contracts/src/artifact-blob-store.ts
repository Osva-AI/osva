/**
 * Public infrastructure port for opaque artifact byte storage.
 *
 * Implementations live outside OSVA core (for example in osva-adapters).
 * Metadata and lifecycle authority remain in OSVA PostgreSQL.
 *
 * Semver: treat this surface as stable within `@osva-ai/contracts` major lines.
 * Digest values use the `sha256:` prefix from trusted-runtime helpers.
 *
 * Streams intentionally avoid Node.js `Readable` types so `@osva-ai/contracts`
 * stays environment-portable at the type level. Node adapters typically pass
 * a `Readable`, which satisfies {@link ArtifactBlobContentStream}.
 */
export interface ArtifactBlobContentStream {
  [Symbol.asyncIterator](): AsyncIterator<Uint8Array>;
}

export interface ArtifactBlobWriteInput {
  readonly key: string;
  readonly content: ArtifactBlobContentStream;
  readonly maxBytes: number;
  readonly expectedDigest?: string;
}

export interface ArtifactBlobWriteResult {
  readonly sizeBytes: number;
  readonly digest: string;
}

export interface ArtifactBlobReadHandle {
  readonly sizeBytes: number;
  readonly stream: ArtifactBlobContentStream;
}

export interface ArtifactBlobStore {
  write(input: ArtifactBlobWriteInput): Promise<ArtifactBlobWriteResult>;
  open(key: string): Promise<ArtifactBlobReadHandle>;
  delete(key: string): Promise<void>;
}
