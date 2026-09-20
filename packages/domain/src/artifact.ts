import type { JsonObject } from "@osva/contracts";
import {
  ARTIFACT_IDEMPOTENCY_KEY_MAX_LENGTH,
  ARTIFACT_MEDIA_TYPE_MAX_LENGTH,
  ARTIFACT_METADATA_MAX_SERIALIZED_BYTES,
  ARTIFACT_NAME_MAX_LENGTH,
  type ArtifactId,
  type RunAttemptId,
  type RunId,
  type WorkspaceId,
} from "@osva/contracts";
import { isSha256IntegrityDigest } from "@osva/contracts";

import { DomainInvariantError } from "./errors.js";
import {
  copyCanonicalJsonValue,
  copyInstant,
  requireBoundedNonEmptyString,
  requireNonNegativeInteger,
} from "./internals.js";

export interface ArtifactProps {
  readonly id: ArtifactId;
  readonly workspaceId: WorkspaceId;
  readonly name: string;
  readonly mediaType: string;
  readonly sizeBytes: number;
  readonly digest: string;
  readonly metadata: JsonObject;
  readonly producerRunId?: RunId;
  readonly producerRunAttemptId?: RunAttemptId;
  readonly idempotencyKey?: string;
  readonly createdAt: Date;
}

export class Artifact {
  readonly id: ArtifactId;
  readonly workspaceId: WorkspaceId;
  readonly name: string;
  readonly mediaType: string;
  readonly sizeBytes: number;
  readonly digest: string;
  readonly metadata: JsonObject;
  readonly producerRunId: RunId | undefined;
  readonly producerRunAttemptId: RunAttemptId | undefined;
  readonly idempotencyKey: string | undefined;
  readonly createdAt: Date;

  private constructor(props: ArtifactProps) {
    this.id = props.id;
    this.workspaceId = props.workspaceId;
    this.name = props.name;
    this.mediaType = props.mediaType;
    this.sizeBytes = props.sizeBytes;
    this.digest = props.digest;
    this.metadata = props.metadata;
    this.producerRunId = props.producerRunId;
    this.producerRunAttemptId = props.producerRunAttemptId;
    this.idempotencyKey = props.idempotencyKey;
    this.createdAt = props.createdAt;
  }

  static create(props: ArtifactProps): Artifact {
    if (!props.id) {
      throw new DomainInvariantError("Artifact.id is required.");
    }

    if (!props.workspaceId) {
      throw new DomainInvariantError("Artifact.workspaceId is required.");
    }

    const name = requireBoundedNonEmptyString(
      props.name,
      "Artifact.name",
      ARTIFACT_NAME_MAX_LENGTH,
    );
    const mediaType = requireBoundedNonEmptyString(
      props.mediaType,
      "Artifact.mediaType",
      ARTIFACT_MEDIA_TYPE_MAX_LENGTH,
    );
    const sizeBytes = requireNonNegativeInteger(
      props.sizeBytes,
      "Artifact.sizeBytes",
    );

    if (!isSha256IntegrityDigest(props.digest)) {
      throw new DomainInvariantError(
        "Artifact.digest must be a canonical sha256 digest.",
      );
    }

    const metadata = validateArtifactMetadata(props.metadata);

    const hasProducerRun = props.producerRunId !== undefined;
    const hasProducerAttempt = props.producerRunAttemptId !== undefined;
    if (hasProducerRun !== hasProducerAttempt) {
      throw new DomainInvariantError(
        "Artifact producer Run and RunAttempt must both be present or both absent.",
      );
    }

    if (hasProducerRun && !props.producerRunId) {
      throw new DomainInvariantError("Artifact.producerRunId is required.");
    }

    if (hasProducerAttempt && !props.producerRunAttemptId) {
      throw new DomainInvariantError(
        "Artifact.producerRunAttemptId is required.",
      );
    }

    const idempotencyKey =
      props.idempotencyKey === undefined
        ? undefined
        : requireBoundedNonEmptyString(
            props.idempotencyKey,
            "Artifact.idempotencyKey",
            ARTIFACT_IDEMPOTENCY_KEY_MAX_LENGTH,
          );

    return Object.freeze(
      new Artifact({
        id: props.id,
        workspaceId: props.workspaceId,
        name,
        mediaType,
        sizeBytes,
        digest: props.digest,
        metadata,
        producerRunId: props.producerRunId,
        producerRunAttemptId: props.producerRunAttemptId,
        idempotencyKey,
        createdAt: copyInstant(props.createdAt),
      }),
    );
  }
}

function validateArtifactMetadata(value: JsonObject): JsonObject {
  const metadata = copyCanonicalJsonValue(
    value,
    "Artifact.metadata",
  ) as JsonObject;

  const serialized = JSON.stringify(metadata);
  if (
    new TextEncoder().encode(serialized).length >
    ARTIFACT_METADATA_MAX_SERIALIZED_BYTES
  ) {
    throw new DomainInvariantError(
      `Artifact.metadata must be at most ${ARTIFACT_METADATA_MAX_SERIALIZED_BYTES} bytes when serialized.`,
    );
  }

  return metadata;
}

export function artifactCreationFingerprint(artifact: Artifact): string {
  return JSON.stringify({
    workspaceId: artifact.workspaceId,
    name: artifact.name,
    mediaType: artifact.mediaType,
    metadata: artifact.metadata,
    producerRunId: artifact.producerRunId ?? null,
    producerRunAttemptId: artifact.producerRunAttemptId ?? null,
    digest: artifact.digest,
  });
}
