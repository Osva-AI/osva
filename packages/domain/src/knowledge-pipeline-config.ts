import {
  KNOWLEDGE_CHUNKER_KEY_RECURSIVE_TEXT,
  KNOWLEDGE_CHUNKER_VERSION_RECURSIVE_TEXT,
  KNOWLEDGE_DEFAULT_CHUNK_OVERLAP_CHARS,
  KNOWLEDGE_DEFAULT_CHUNK_SIZE_CHARS,
  KNOWLEDGE_DISTANCE_METRICS,
  KNOWLEDGE_PARSER_KEY_OSVA_NATIVE,
  KNOWLEDGE_PARSER_VERSION_OSVA_NATIVE,
  type KnowledgeDistanceMetric,
} from "@osva/contracts";

import type { ResolvedKnowledgePipelineConfig } from "./knowledge-pipeline-fingerprint.js";

export interface KnowledgeEmbeddingDefaults {
  readonly provider: string;
  readonly model: string;
  readonly dimensions: number;
}

export function resolveDefaultKnowledgePipeline(
  embedding: KnowledgeEmbeddingDefaults,
): ResolvedKnowledgePipelineConfig {
  const distanceMetric: KnowledgeDistanceMetric = "COSINE";
  if (!KNOWLEDGE_DISTANCE_METRICS.includes(distanceMetric)) {
    throw new Error("Unsupported distance metric.");
  }

  return {
    parserKey: KNOWLEDGE_PARSER_KEY_OSVA_NATIVE,
    parserVersion: KNOWLEDGE_PARSER_VERSION_OSVA_NATIVE,
    chunkerKey: KNOWLEDGE_CHUNKER_KEY_RECURSIVE_TEXT,
    chunkerVersion: KNOWLEDGE_CHUNKER_VERSION_RECURSIVE_TEXT,
    chunkSize: KNOWLEDGE_DEFAULT_CHUNK_SIZE_CHARS,
    chunkOverlap: KNOWLEDGE_DEFAULT_CHUNK_OVERLAP_CHARS,
    embeddingProvider: embedding.provider,
    embeddingModel: embedding.model,
    embeddingDimensions: embedding.dimensions,
    distanceMetric,
  };
}
