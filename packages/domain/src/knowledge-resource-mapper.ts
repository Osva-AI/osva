import { ARTIFACT_REFERENCE_TYPE } from "@osva/contracts";
import type {
  KnowledgeIndexResourceV1,
  KnowledgeSourceResourceV1,
} from "@osva/contracts";

import type { KnowledgeIndex } from "./knowledge-index.js";
import type { KnowledgeSource } from "./knowledge-source.js";

export function toKnowledgeSourceResource(
  source: KnowledgeSource,
): KnowledgeSourceResourceV1 {
  return {
    id: source.id,
    workspaceId: source.workspaceId,
    key: source.key,
    name: source.name,
    artifactId: source.artifactId,
    attributes: source.attributes,
    createdAt: source.createdAt.toISOString(),
  };
}

export function toKnowledgeIndexResource(
  index: KnowledgeIndex,
): KnowledgeIndexResourceV1 {
  return {
    id: index.id,
    workspaceId: index.workspaceId,
    knowledgeSourceId: index.knowledgeSourceId,
    status: index.status,
    parserKey: index.parserKey,
    parserVersion: index.parserVersion,
    chunkerKey: index.chunkerKey,
    chunkerVersion: index.chunkerVersion,
    chunkSize: index.chunkSize,
    chunkOverlap: index.chunkOverlap,
    embeddingProvider: index.embeddingProvider,
    embeddingModel: index.embeddingModel,
    embeddingDimensions: index.embeddingDimensions,
    distanceMetric: index.distanceMetric,
    pipelineFingerprint: index.pipelineFingerprint,
    extractedArtifactId: index.extractedArtifactId,
    attemptCount: index.attemptCount,
    chunkCount: index.chunkCount,
    embeddedChunkCount: index.embeddedChunkCount,
    lastErrorCode: index.lastErrorCode,
    lastErrorMessage: index.lastErrorMessage,
    createdAt: index.createdAt.toISOString(),
    updatedAt: index.updatedAt.toISOString(),
    readyAt: index.readyAt?.toISOString(),
  };
}

export function artifactReferenceForSource(source: KnowledgeSource) {
  return {
    type: ARTIFACT_REFERENCE_TYPE,
    artifactId: source.artifactId,
  };
}
