import type { ArtifactId } from "@osva/contracts";

import { DomainInvariantError } from "./errors.js";

const UNSAFE_BLOB_KEY_CHAR_PATTERN = /[\\/\0]/;
const BLOB_KEY_PREFIX = "v1/";

/**
 * Deterministic internal blob key for an Artifact. Never derived from user
 * filenames or workspace names.
 */
export function artifactBlobStorageKey(artifactId: ArtifactId): string {
  if (typeof artifactId !== "string" || artifactId.length === 0) {
    throw new DomainInvariantError(
      "ArtifactId is required for blob storage key.",
    );
  }

  if (
    UNSAFE_BLOB_KEY_CHAR_PATTERN.test(artifactId) ||
    artifactId.includes("..")
  ) {
    throw new DomainInvariantError(
      "ArtifactId contains characters unsuitable for blob storage keys.",
    );
  }

  return `${BLOB_KEY_PREFIX}${artifactId}`;
}

export function artifactIdFromBlobStorageKey(key: string): ArtifactId {
  if (!key.startsWith(BLOB_KEY_PREFIX)) {
    throw new DomainInvariantError("Blob storage key has an invalid prefix.");
  }

  const artifactId = key.slice(BLOB_KEY_PREFIX.length) as ArtifactId;
  if (artifactId.length === 0) {
    throw new DomainInvariantError("Blob storage key is missing ArtifactId.");
  }

  return artifactId;
}
