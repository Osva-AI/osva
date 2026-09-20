import type {
  ArtifactId,
  KnowledgeChunkId,
  KnowledgeIndexId,
  KnowledgeSourceId,
  WorkspaceId,
} from "./ids.js";
import type { ArtifactReferenceV1 } from "./artifact.js";
import type { JsonObject } from "./json-value.js";

export const KNOWLEDGE_SOURCE_KEY_MAX_LENGTH = 128;
export const KNOWLEDGE_SOURCE_NAME_MAX_LENGTH = 255;
export const KNOWLEDGE_IDEMPOTENCY_KEY_MAX_LENGTH = 256;
export const KNOWLEDGE_ATTRIBUTES_MAX_SERIALIZED_BYTES = 8 * 1024;
export const KNOWLEDGE_CHUNK_TEXT_MAX_BYTES = 32 * 1024;
export const KNOWLEDGE_LOCATION_MAX_SERIALIZED_BYTES = 2 * 1024;
export const KNOWLEDGE_MAX_SOURCE_BYTES = 50 * 1024 * 1024;
export const KNOWLEDGE_MAX_EXTRACTED_BYTES = 100 * 1024 * 1024;
export const KNOWLEDGE_MAX_TEXT_SEGMENTS = 100_000;
export const KNOWLEDGE_MAX_CHUNKS_PER_INDEX = 10_000;
export const KNOWLEDGE_MAX_QUERY_LENGTH = 4_096;
export const KNOWLEDGE_MAX_TOP_K = 50;
export const KNOWLEDGE_MAX_INDEX_IDS_PER_RETRIEVE = 32;
export const KNOWLEDGE_MAX_FILTER_KEYS = 16;
export const KNOWLEDGE_MAX_FILTER_VALUE_LENGTH = 256;

export const KNOWLEDGE_INDEX_STATES = [
  "PENDING",
  "RUNNING",
  "READY",
  "FAILED",
] as const;

export type KnowledgeIndexState = (typeof KNOWLEDGE_INDEX_STATES)[number];

export const KNOWLEDGE_DISTANCE_METRICS = ["COSINE"] as const;

export type KnowledgeDistanceMetric =
  (typeof KNOWLEDGE_DISTANCE_METRICS)[number];

export const KNOWLEDGE_EXTRACTION_MEDIA_TYPE =
  "application/vnd.osva.knowledge-extraction+ndjson" as const;

export const KNOWLEDGE_PARSER_KEY_OSVA_NATIVE = "osva_native_v1" as const;
export const KNOWLEDGE_PARSER_VERSION_OSVA_NATIVE = "1" as const;

export const KNOWLEDGE_CHUNKER_KEY_RECURSIVE_TEXT =
  "recursive_text_v1" as const;
export const KNOWLEDGE_CHUNKER_VERSION_RECURSIVE_TEXT = "1" as const;

export const KNOWLEDGE_DEFAULT_CHUNK_SIZE_CHARS = 1500;
export const KNOWLEDGE_DEFAULT_CHUNK_OVERLAP_CHARS = 200;

export const KNOWLEDGE_ERROR_CODES = {
  KNOWLEDGE_SOURCE_NOT_FOUND: "KNOWLEDGE_SOURCE_NOT_FOUND",
  KNOWLEDGE_INDEX_NOT_FOUND: "KNOWLEDGE_INDEX_NOT_FOUND",
  KNOWLEDGE_INDEX_NOT_READY: "KNOWLEDGE_INDEX_NOT_READY",
  KNOWLEDGE_INDEX_NOT_RETRYABLE: "KNOWLEDGE_INDEX_NOT_RETRYABLE",
  KNOWLEDGE_UNSUPPORTED_MEDIA_TYPE: "KNOWLEDGE_UNSUPPORTED_MEDIA_TYPE",
  KNOWLEDGE_EXTRACTION_FAILED: "KNOWLEDGE_EXTRACTION_FAILED",
  KNOWLEDGE_SOURCE_TOO_LARGE: "KNOWLEDGE_SOURCE_TOO_LARGE",
  KNOWLEDGE_EMBEDDING_FAILED: "KNOWLEDGE_EMBEDDING_FAILED",
  KNOWLEDGE_VECTOR_STORE_UNAVAILABLE: "KNOWLEDGE_VECTOR_STORE_UNAVAILABLE",
  KNOWLEDGE_INCOMPATIBLE_INDEXES: "KNOWLEDGE_INCOMPATIBLE_INDEXES",
  KNOWLEDGE_INVALID_FILTER: "KNOWLEDGE_INVALID_FILTER",
  KNOWLEDGE_IDEMPOTENCY_CONFLICT: "KNOWLEDGE_IDEMPOTENCY_CONFLICT",
  KNOWLEDGE_PERMISSION_DENIED: "KNOWLEDGE_PERMISSION_DENIED",
  KNOWLEDGE_UNAVAILABLE: "KNOWLEDGE_UNAVAILABLE",
  KNOWLEDGE_BINDING_NOT_FOUND: "KNOWLEDGE_BINDING_NOT_FOUND",
} as const;

export type KnowledgeErrorCode =
  (typeof KNOWLEDGE_ERROR_CODES)[keyof typeof KNOWLEDGE_ERROR_CODES];

export function isKnowledgeIndexState(
  value: string,
): value is KnowledgeIndexState {
  return (KNOWLEDGE_INDEX_STATES as readonly string[]).includes(value);
}

export function isKnowledgeDistanceMetric(
  value: string,
): value is KnowledgeDistanceMetric {
  return (KNOWLEDGE_DISTANCE_METRICS as readonly string[]).includes(value);
}

export function isKnowledgeErrorCode(
  value: string,
): value is KnowledgeErrorCode {
  return (Object.values(KNOWLEDGE_ERROR_CODES) as readonly string[]).includes(
    value,
  );
}

export interface KnowledgeChunkLocationV1 {
  readonly page?: number;
  readonly heading?: string;
  readonly sourceSegmentOrdinal?: number;
}

export interface KnowledgeTextSegmentV1 {
  readonly ordinal: number;
  readonly text: string;
  readonly location?: KnowledgeChunkLocationV1;
}

export interface KnowledgeSourceResourceV1 {
  readonly id: KnowledgeSourceId;
  readonly workspaceId: WorkspaceId;
  readonly key: string;
  readonly name: string;
  readonly artifactId: ArtifactId;
  readonly attributes: JsonObject;
  readonly createdAt: string;
}

export interface KnowledgeIndexResourceV1 {
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
  readonly chunkCount?: number;
  readonly embeddedChunkCount?: number;
  readonly lastErrorCode?: KnowledgeErrorCode;
  readonly lastErrorMessage?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly readyAt?: string;
}

export interface KnowledgeHitV1 {
  readonly knowledgeChunkId: KnowledgeChunkId;
  readonly knowledgeIndexId: KnowledgeIndexId;
  readonly knowledgeSourceId: KnowledgeSourceId;
  readonly artifactReference: ArtifactReferenceV1;
  readonly text: string;
  readonly score: number;
  readonly location?: KnowledgeChunkLocationV1;
  readonly attributes: JsonObject;
}
