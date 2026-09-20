import type { ArtifactId } from "./ids.js";

export const ARTIFACT_NAME_MAX_LENGTH = 255;
export const ARTIFACT_MEDIA_TYPE_MAX_LENGTH = 255;
export const ARTIFACT_IDEMPOTENCY_KEY_MAX_LENGTH = 256;
export const ARTIFACT_METADATA_MAX_SERIALIZED_BYTES = 16 * 1024;

export const ARTIFACT_REFERENCE_TYPE = "artifact" as const;

export interface ArtifactReferenceV1 {
  readonly type: typeof ARTIFACT_REFERENCE_TYPE;
  readonly artifactId: ArtifactId;
}
