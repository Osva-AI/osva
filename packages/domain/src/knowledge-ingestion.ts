import { Readable } from "node:stream";
import { text } from "node:stream/consumers";

import type {
  ArtifactId,
  KnowledgeChunkId,
  KnowledgeIndexId,
} from "@osva/contracts";
import {
  KNOWLEDGE_EXTRACTION_MEDIA_TYPE,
  KNOWLEDGE_MAX_TEXT_SEGMENTS,
  type KnowledgeTextSegmentV1,
} from "@osva/contracts";

import type {
  CreateArtifact,
  OpenArtifactContent,
} from "./artifact-application.js";
import {
  KnowledgeChunkConsistencyError,
  KnowledgeEmbeddingFailedError,
  KnowledgeExtractionFailedError,
  KnowledgeIndexNotFoundError,
  KnowledgeSourceNotFoundError,
  KnowledgeSourceTooLargeError,
  KnowledgeUnsupportedMediaTypeError,
  KnowledgeVectorStoreUnavailableError,
} from "./errors.js";
import { KnowledgeChunk } from "./knowledge-chunk.js";
import { chunkKnowledgeText } from "./knowledge-chunker.js";
import { KnowledgeIndex } from "./knowledge-index.js";
import type { EmbeddingGateway } from "./ports/embedding-gateway.js";
import type { KnowledgeParserRegistry } from "./ports/knowledge-parser.js";
import type { KnowledgeRepository } from "./ports/knowledge-repository.js";
import type { VectorStore } from "./ports/vector-store.js";

export const KNOWLEDGE_INDEX_LEASE_MS = 5 * 60 * 1000;

export interface KnowledgeIngestionLogger {
  info(message: string, fields?: Readonly<Record<string, unknown>>): void;
  warn(message: string, fields?: Readonly<Record<string, unknown>>): void;
}

export interface KnowledgeIngestionDependencies {
  readonly knowledge: KnowledgeRepository;
  readonly parsers: KnowledgeParserRegistry;
  readonly createArtifact: CreateArtifact;
  readonly openArtifact: OpenArtifactContent;
  readonly embeddings: EmbeddingGateway;
  readonly vectorStore: VectorStore;
  readonly clock: { now(): Date };
  readonly ids: { createId(): string };
  readonly logger?: KnowledgeIngestionLogger;
  readonly maxSourceBytes: number;
  readonly maxExtractedBytes: number;
}

export class KnowledgeIngestionService {
  constructor(private readonly deps: KnowledgeIngestionDependencies) {}

  async processIndex(knowledgeIndexId: KnowledgeIndexId): Promise<void> {
    const index = await this.deps.knowledge.findIndexById(knowledgeIndexId);
    if (index === null) {
      throw new KnowledgeIndexNotFoundError(knowledgeIndexId);
    }
    if (index.status === "READY") {
      return;
    }

    const leaseToken = this.deps.ids.createId();
    const now = this.deps.clock.now();
    const claimed = await this.deps.knowledge.claimIndexLease({
      knowledgeIndexId,
      workspaceId: index.workspaceId,
      leaseToken,
      leaseExpiresAt: new Date(now.getTime() + KNOWLEDGE_INDEX_LEASE_MS),
      now,
    });
    if (claimed === null) {
      return;
    }

    this.deps.logger?.info("knowledge.index.claimed", {
      knowledgeIndexId,
      workspaceId: claimed.workspaceId,
    });

    try {
      await this.ingestClaimed(claimed);
    } catch (error) {
      await this.markFailed(claimed.id, error);
      throw error;
    }
  }

  private async ingestClaimed(index: KnowledgeIndex): Promise<void> {
    const source = await this.deps.knowledge.findSourceById(
      index.knowledgeSourceId,
    );
    if (source === null) {
      throw new KnowledgeSourceNotFoundError(index.knowledgeSourceId);
    }

    let current = index;
    let extractedArtifactId = current.extractedArtifactId;
    if (extractedArtifactId === undefined) {
      extractedArtifactId = await this.extractAndPersist(
        current,
        source.artifactId,
      );
      current = patchIndex(current, {
        extractedArtifactId,
        updatedAt: this.deps.clock.now(),
      });
      await this.deps.knowledge.updateIndex(current);
      this.deps.logger?.info("knowledge.extraction.completed", {
        knowledgeIndexId: current.id,
        extractedArtifactId,
      });
    }

    const segments = await this.loadExtractionSegments(extractedArtifactId);
    const chunks = chunkKnowledgeText({
      segments,
      chunkSize: current.chunkSize,
      chunkOverlap: current.chunkOverlap,
    });

    const now = this.deps.clock.now();
    for (const chunk of chunks) {
      const existing = await this.deps.knowledge.findChunkByIndexOrdinal(
        current.id,
        chunk.ordinal,
      );
      if (existing !== null) {
        if (existing.text !== chunk.text) {
          throw new KnowledgeChunkConsistencyError(current.id, chunk.ordinal);
        }
        continue;
      }

      await this.deps.knowledge.saveChunk(
        KnowledgeChunk.create({
          id: this.deps.ids.createId() as KnowledgeChunkId,
          workspaceId: current.workspaceId,
          knowledgeIndexId: current.id,
          ordinal: chunk.ordinal,
          text: chunk.text,
          location: chunk.location,
          createdAt: now,
        }),
      );
    }

    this.deps.logger?.info("knowledge.chunking.completed", {
      knowledgeIndexId: current.id,
      chunkCount: chunks.length,
    });

    const persistedChunks = await this.deps.knowledge.listChunksByIndex(
      current.id,
    );
    const embeddings = await this.deps.embeddings.embedDocuments({
      texts: persistedChunks.map((chunk) => chunk.text),
      provider: current.embeddingProvider,
      model: current.embeddingModel,
      dimensions: current.embeddingDimensions,
    });
    if (embeddings.vectors.length !== persistedChunks.length) {
      throw new KnowledgeEmbeddingFailedError();
    }

    try {
      await this.deps.vectorStore.upsert(
        persistedChunks.map((chunk, i) => ({
          workspaceId: current.workspaceId,
          knowledgeIndexId: current.id,
          knowledgeChunkId: chunk.id,
          embedding: embeddings.vectors[i]!,
        })),
      );
    } catch {
      throw new KnowledgeVectorStoreUnavailableError();
    }

    this.deps.logger?.info("knowledge.embedding.completed", {
      knowledgeIndexId: current.id,
      embeddedChunkCount: persistedChunks.length,
    });

    const vectorCount = await this.deps.vectorStore.countForIndex(current.id);
    if (vectorCount !== persistedChunks.length) {
      throw new KnowledgeVectorStoreUnavailableError(
        "Vector materialization is incomplete.",
      );
    }

    const readyAt = this.deps.clock.now();
    const ready = current.transitionTo("READY", {
      updatedAt: readyAt,
      readyAt,
      chunkCount: persistedChunks.length,
      embeddedChunkCount: persistedChunks.length,
      leaseToken: null,
      leaseExpiresAt: null,
    });
    await this.deps.knowledge.updateIndex(ready);
    this.deps.logger?.info("knowledge.index.ready", {
      knowledgeIndexId: current.id,
    });
  }

  private async extractAndPersist(
    index: KnowledgeIndex,
    artifactId: ArtifactId,
  ): Promise<ArtifactId> {
    const opened = await this.deps.openArtifact.execute(artifactId);
    if (opened.artifact.sizeBytes > this.deps.maxSourceBytes) {
      throw new KnowledgeSourceTooLargeError();
    }

    const parser = this.deps.parsers.resolve(opened.artifact.mediaType);
    const lines: string[] = [];
    let segmentCount = 0;
    let bytes = 0;

    try {
      for await (const segment of parser.parse({
        content: opened.content.stream,
        mediaType: opened.artifact.mediaType,
      })) {
        segmentCount += 1;
        if (segmentCount > KNOWLEDGE_MAX_TEXT_SEGMENTS) {
          throw new KnowledgeSourceTooLargeError();
        }
        const line = JSON.stringify(segmentToLine(segment));
        bytes += Buffer.byteLength(line, "utf8") + 1;
        if (bytes > this.deps.maxExtractedBytes) {
          throw new KnowledgeSourceTooLargeError();
        }
        lines.push(line);
      }
    } catch (error) {
      if (
        error instanceof KnowledgeSourceTooLargeError ||
        error instanceof KnowledgeUnsupportedMediaTypeError
      ) {
        throw error;
      }
      throw new KnowledgeExtractionFailedError();
    }

    const body = lines.length === 0 ? "" : `${lines.join("\n")}\n`;
    const artifact = await this.deps.createArtifact.execute({
      workspaceId: index.workspaceId,
      name: `knowledge-extraction-${index.id}.ndjson`,
      mediaType: KNOWLEDGE_EXTRACTION_MEDIA_TYPE,
      metadata: {
        knowledgeIndexId: index.id,
        knowledgeSourceId: index.knowledgeSourceId,
      },
      content: Readable.from(body),
    });
    return artifact.id;
  }

  private async loadExtractionSegments(
    artifactId: ArtifactId,
  ): Promise<readonly KnowledgeTextSegmentV1[]> {
    const opened = await this.deps.openArtifact.execute(artifactId);
    const raw = await text(opened.content.stream);
    return raw
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map((line) => {
        const parsed = JSON.parse(line) as Record<string, unknown>;
        return {
          ordinal: Number(parsed.ordinal),
          text: String(parsed.text),
          location: {
            page: parsed.page === undefined ? undefined : Number(parsed.page),
            heading:
              parsed.heading === undefined ? undefined : String(parsed.heading),
            sourceSegmentOrdinal:
              parsed.sourceSegmentOrdinal === undefined
                ? undefined
                : Number(parsed.sourceSegmentOrdinal),
          },
        };
      });
  }

  private async markFailed(
    knowledgeIndexId: KnowledgeIndexId,
    error: unknown,
  ): Promise<void> {
    const index = await this.deps.knowledge.findIndexById(knowledgeIndexId);
    if (index === null || index.status !== "RUNNING") {
      return;
    }

    const code =
      error instanceof Error && "code" in error
        ? String((error as { code: string }).code)
        : "KNOWLEDGE_UNAVAILABLE";
    const message =
      error instanceof Error ? error.message : "Knowledge ingestion failed.";
    const now = this.deps.clock.now();
    const failed = index.transitionTo("FAILED", {
      updatedAt: now,
      lastErrorCode: code as KnowledgeIndex["lastErrorCode"],
      lastErrorMessage: message.slice(0, 512),
      leaseToken: null,
      leaseExpiresAt: null,
    });
    await this.deps.knowledge.updateIndex(failed);
    this.deps.logger?.warn("knowledge.index.failed", {
      knowledgeIndexId,
      code,
    });
  }
}

function segmentToLine(
  segment: KnowledgeTextSegmentV1,
): Record<string, unknown> {
  return {
    ordinal: segment.ordinal,
    text: segment.text,
    ...(segment.location?.page !== undefined
      ? { page: segment.location.page }
      : {}),
    ...(segment.location?.heading !== undefined
      ? { heading: segment.location.heading }
      : {}),
    ...(segment.location?.sourceSegmentOrdinal !== undefined
      ? { sourceSegmentOrdinal: segment.location.sourceSegmentOrdinal }
      : {}),
  };
}

function patchIndex(
  index: KnowledgeIndex,
  patch: { readonly extractedArtifactId: ArtifactId; readonly updatedAt: Date },
): KnowledgeIndex {
  return KnowledgeIndex.rehydrate({
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
    extractedArtifactId: patch.extractedArtifactId,
    attemptCount: index.attemptCount,
    leaseToken: index.leaseToken,
    leaseExpiresAt: index.leaseExpiresAt,
    chunkCount: index.chunkCount,
    embeddedChunkCount: index.embeddedChunkCount,
    lastErrorCode: index.lastErrorCode,
    lastErrorMessage: index.lastErrorMessage,
    idempotencyKey: index.idempotencyKey,
    createdAt: index.createdAt,
    updatedAt: patch.updatedAt,
    readyAt: index.readyAt,
  });
}
