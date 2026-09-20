import type {
  ArtifactId,
  KnowledgeErrorCode,
  KnowledgeIndexId,
  KnowledgeIndexState,
  KnowledgeSourceId,
  KnowledgeDistanceMetric,
  WorkspaceId,
} from "@osva/contracts";

import { DomainInvariantError } from "./errors.js";
import { copyInstant, requireNonEmptyString } from "./internals.js";
import { assertLegalKnowledgeIndexTransition } from "./knowledge-index-state-machine.js";

export interface KnowledgeIndexCreateProps {
  readonly id: KnowledgeIndexId;
  readonly workspaceId: WorkspaceId;
  readonly knowledgeSourceId: KnowledgeSourceId;
  readonly parserKey: string;
  readonly parserVersion: string;
  readonly chunkerKey: string;
  readonly chunkerVersion: string;
  readonly chunkSize: number;
  readonly chunkOverlap: number;
  readonly embeddingProvider: string;
  readonly embeddingModel: string;
  readonly embeddingDimensions: number;
  readonly distanceMetric: KnowledgeDistanceMetric;
  readonly pipelineFingerprint: string;
  readonly idempotencyKey?: string;
  readonly createdAt: Date;
}

export interface KnowledgeIndexRehydrateProps {
  readonly id: KnowledgeIndexId;
  readonly workspaceId: WorkspaceId;
  readonly knowledgeSourceId: KnowledgeSourceId;
  readonly status: KnowledgeIndexState;
  readonly parserKey: string;
  readonly parserVersion: string;
  readonly chunkerKey: string;
  readonly chunkerVersion: string;
  readonly chunkSize: number;
  readonly chunkOverlap: number;
  readonly embeddingProvider: string;
  readonly embeddingModel: string;
  readonly embeddingDimensions: number;
  readonly distanceMetric: KnowledgeDistanceMetric;
  readonly pipelineFingerprint: string;
  readonly extractedArtifactId?: ArtifactId;
  readonly attemptCount: number;
  readonly leaseToken?: string;
  readonly leaseExpiresAt?: Date;
  readonly chunkCount?: number;
  readonly embeddedChunkCount?: number;
  readonly lastErrorCode?: KnowledgeErrorCode;
  readonly lastErrorMessage?: string;
  readonly idempotencyKey?: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly readyAt?: Date;
}

export class KnowledgeIndex {
  readonly id: KnowledgeIndexId;
  readonly workspaceId: WorkspaceId;
  readonly knowledgeSourceId: KnowledgeSourceId;
  readonly status: KnowledgeIndexState;
  readonly parserKey: string;
  readonly parserVersion: string;
  readonly chunkerKey: string;
  readonly chunkerVersion: string;
  readonly chunkSize: number;
  readonly chunkOverlap: number;
  readonly embeddingProvider: string;
  readonly embeddingModel: string;
  readonly embeddingDimensions: number;
  readonly distanceMetric: KnowledgeDistanceMetric;
  readonly pipelineFingerprint: string;
  readonly extractedArtifactId: ArtifactId | undefined;
  readonly attemptCount: number;
  readonly leaseToken: string | undefined;
  readonly leaseExpiresAt: Date | undefined;
  readonly chunkCount: number | undefined;
  readonly embeddedChunkCount: number | undefined;
  readonly lastErrorCode: KnowledgeErrorCode | undefined;
  readonly lastErrorMessage: string | undefined;
  readonly idempotencyKey: string | undefined;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly readyAt: Date | undefined;

  private constructor(props: KnowledgeIndexRehydrateProps) {
    this.id = props.id;
    this.workspaceId = props.workspaceId;
    this.knowledgeSourceId = props.knowledgeSourceId;
    this.status = props.status;
    this.parserKey = props.parserKey;
    this.parserVersion = props.parserVersion;
    this.chunkerKey = props.chunkerKey;
    this.chunkerVersion = props.chunkerVersion;
    this.chunkSize = props.chunkSize;
    this.chunkOverlap = props.chunkOverlap;
    this.embeddingProvider = props.embeddingProvider;
    this.embeddingModel = props.embeddingModel;
    this.embeddingDimensions = props.embeddingDimensions;
    this.distanceMetric = props.distanceMetric;
    this.pipelineFingerprint = props.pipelineFingerprint;
    this.extractedArtifactId = props.extractedArtifactId;
    this.attemptCount = props.attemptCount;
    this.leaseToken = props.leaseToken;
    this.leaseExpiresAt = props.leaseExpiresAt
      ? copyInstant(props.leaseExpiresAt)
      : undefined;
    this.chunkCount = props.chunkCount;
    this.embeddedChunkCount = props.embeddedChunkCount;
    this.lastErrorCode = props.lastErrorCode;
    this.lastErrorMessage = props.lastErrorMessage;
    this.idempotencyKey = props.idempotencyKey;
    this.createdAt = copyInstant(props.createdAt);
    this.updatedAt = copyInstant(props.updatedAt);
    this.readyAt = props.readyAt ? copyInstant(props.readyAt) : undefined;
  }

  static create(props: KnowledgeIndexCreateProps): KnowledgeIndex {
    if (props.chunkSize <= 0) {
      throw new DomainInvariantError("chunkSize must be positive.");
    }
    if (props.chunkOverlap < 0) {
      throw new DomainInvariantError("chunkOverlap must be non-negative.");
    }
    if (props.embeddingDimensions <= 0) {
      throw new DomainInvariantError("embeddingDimensions must be positive.");
    }

    return new KnowledgeIndex({
      id: props.id,
      workspaceId: props.workspaceId,
      knowledgeSourceId: props.knowledgeSourceId,
      status: "PENDING",
      parserKey: requireNonEmptyString(props.parserKey, "parserKey"),
      parserVersion: requireNonEmptyString(
        props.parserVersion,
        "parserVersion",
      ),
      chunkerKey: requireNonEmptyString(props.chunkerKey, "chunkerKey"),
      chunkerVersion: requireNonEmptyString(
        props.chunkerVersion,
        "chunkerVersion",
      ),
      chunkSize: props.chunkSize,
      chunkOverlap: props.chunkOverlap,
      embeddingProvider: requireNonEmptyString(
        props.embeddingProvider,
        "embeddingProvider",
      ),
      embeddingModel: requireNonEmptyString(
        props.embeddingModel,
        "embeddingModel",
      ),
      embeddingDimensions: props.embeddingDimensions,
      distanceMetric: props.distanceMetric,
      pipelineFingerprint: requireNonEmptyString(
        props.pipelineFingerprint,
        "pipelineFingerprint",
      ),
      attemptCount: 0,
      idempotencyKey: props.idempotencyKey,
      createdAt: props.createdAt,
      updatedAt: props.createdAt,
    });
  }

  static rehydrate(props: KnowledgeIndexRehydrateProps): KnowledgeIndex {
    return new KnowledgeIndex(props);
  }

  transitionTo(
    nextStatus: KnowledgeIndexState,
    patch: {
      readonly updatedAt: Date;
      readonly readyAt?: Date;
      readonly extractedArtifactId?: ArtifactId;
      readonly chunkCount?: number;
      readonly embeddedChunkCount?: number;
      readonly lastErrorCode?: KnowledgeErrorCode | null;
      readonly lastErrorMessage?: string | null;
      readonly leaseToken?: string | null;
      readonly leaseExpiresAt?: Date | null;
      readonly attemptCount?: number;
    },
  ): KnowledgeIndex {
    assertLegalKnowledgeIndexTransition(this.status, nextStatus);
    if (this.status === "READY") {
      throw new DomainInvariantError("READY KnowledgeIndex cannot transition.");
    }

    return new KnowledgeIndex({
      ...this.toProps(),
      status: nextStatus,
      updatedAt: patch.updatedAt,
      readyAt: patch.readyAt ?? this.readyAt,
      extractedArtifactId:
        patch.extractedArtifactId ?? this.extractedArtifactId,
      chunkCount: patch.chunkCount ?? this.chunkCount,
      embeddedChunkCount: patch.embeddedChunkCount ?? this.embeddedChunkCount,
      lastErrorCode:
        patch.lastErrorCode === undefined
          ? this.lastErrorCode
          : (patch.lastErrorCode ?? undefined),
      lastErrorMessage:
        patch.lastErrorMessage === undefined
          ? this.lastErrorMessage
          : (patch.lastErrorMessage ?? undefined),
      leaseToken:
        patch.leaseToken === null
          ? undefined
          : (patch.leaseToken ?? this.leaseToken),
      leaseExpiresAt:
        patch.leaseExpiresAt === null
          ? undefined
          : (patch.leaseExpiresAt ?? this.leaseExpiresAt),
      attemptCount: patch.attemptCount ?? this.attemptCount,
    });
  }

  private toProps(): KnowledgeIndexRehydrateProps {
    return {
      id: this.id,
      workspaceId: this.workspaceId,
      knowledgeSourceId: this.knowledgeSourceId,
      status: this.status,
      parserKey: this.parserKey,
      parserVersion: this.parserVersion,
      chunkerKey: this.chunkerKey,
      chunkerVersion: this.chunkerVersion,
      chunkSize: this.chunkSize,
      chunkOverlap: this.chunkOverlap,
      embeddingProvider: this.embeddingProvider,
      embeddingModel: this.embeddingModel,
      embeddingDimensions: this.embeddingDimensions,
      distanceMetric: this.distanceMetric,
      pipelineFingerprint: this.pipelineFingerprint,
      extractedArtifactId: this.extractedArtifactId,
      attemptCount: this.attemptCount,
      leaseToken: this.leaseToken,
      leaseExpiresAt: this.leaseExpiresAt,
      chunkCount: this.chunkCount,
      embeddedChunkCount: this.embeddedChunkCount,
      lastErrorCode: this.lastErrorCode,
      lastErrorMessage: this.lastErrorMessage,
      idempotencyKey: this.idempotencyKey,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
      readyAt: this.readyAt,
    };
  }
}
