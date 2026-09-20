import { createHash } from "node:crypto";

import type { KnowledgeDistanceMetric } from "@osva/contracts";

export interface ResolvedKnowledgePipelineConfig {
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
}

export function computeKnowledgePipelineFingerprint(
  config: ResolvedKnowledgePipelineConfig,
): string {
  const canonical = JSON.stringify({
    parserKey: config.parserKey,
    parserVersion: config.parserVersion,
    chunkerKey: config.chunkerKey,
    chunkerVersion: config.chunkerVersion,
    chunkSize: config.chunkSize,
    chunkOverlap: config.chunkOverlap,
    embeddingProvider: config.embeddingProvider,
    embeddingModel: config.embeddingModel,
    embeddingDimensions: config.embeddingDimensions,
    distanceMetric: config.distanceMetric,
  });

  return `sha256:${createHash("sha256").update(canonical, "utf8").digest("hex")}`;
}
