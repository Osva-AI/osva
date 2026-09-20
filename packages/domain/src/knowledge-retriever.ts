import type {
  JsonObject,
  KnowledgeHitV1,
  KnowledgeIndexId,
  WorkspaceId,
} from "@osva/contracts";
import { KNOWLEDGE_MAX_TOP_K } from "@osva/contracts";

import {
  KnowledgeIncompatibleIndexesError,
  KnowledgeIndexNotFoundError,
  KnowledgeIndexNotReadyError,
  KnowledgeInvalidFilterError,
} from "./errors.js";
import { knowledgeAttributesMatchFilter } from "./knowledge-attributes.js";
import { artifactReferenceForSource } from "./knowledge-resource-mapper.js";
import type { KnowledgeIndex } from "./knowledge-index.js";
import type { EmbeddingGateway } from "./ports/embedding-gateway.js";
import type { KnowledgeRepository } from "./ports/knowledge-repository.js";
import type { VectorStore } from "./ports/vector-store.js";
import { validateKnowledgeFlatAttributes } from "./knowledge-attributes.js";

export interface KnowledgeRetrieveCommand {
  readonly workspaceId: WorkspaceId;
  readonly knowledgeIndexIds: readonly KnowledgeIndexId[];
  readonly query: string;
  readonly topK?: number;
  readonly filter?: JsonObject;
}

export interface KnowledgeRetrieverDependencies {
  readonly knowledge: KnowledgeRepository;
  readonly embeddings: EmbeddingGateway;
  readonly vectorStore: VectorStore;
}

export class KnowledgeRetriever {
  constructor(private readonly deps: KnowledgeRetrieverDependencies) {}

  async retrieve(command: KnowledgeRetrieveCommand): Promise<KnowledgeHitV1[]> {
    const topK = Math.min(Math.max(1, command.topK ?? 5), KNOWLEDGE_MAX_TOP_K);
    const filter = command.filter
      ? validateKnowledgeFlatAttributes(command.filter)
      : undefined;

    const indexes: KnowledgeIndex[] = [];
    for (const id of command.knowledgeIndexIds) {
      const index = await this.deps.knowledge.findIndexById(id);
      if (index === null || index.workspaceId !== command.workspaceId) {
        throw new KnowledgeIndexNotFoundError(id);
      }
      if (index.status !== "READY") {
        throw new KnowledgeIndexNotReadyError(id);
      }
      indexes.push(index);
    }

    assertCompatibleIndexes(indexes);

    const reference = indexes[0]!;
    const queryVector = await this.deps.embeddings.embedQuery({
      query: command.query,
      provider: reference.embeddingProvider,
      model: reference.embeddingModel,
      dimensions: reference.embeddingDimensions,
    });

    const matches = await this.deps.vectorStore.query({
      workspaceId: command.workspaceId,
      knowledgeIndexIds: command.knowledgeIndexIds,
      queryVector,
      topK,
      filter,
    });

    const chunks = await this.deps.knowledge.findChunksByIds(
      matches.map((match) => match.knowledgeChunkId),
      command.workspaceId,
    );
    const chunkById = new Map(chunks.map((chunk) => [chunk.id, chunk]));

    const hits: KnowledgeHitV1[] = [];
    for (const match of matches) {
      const chunk = chunkById.get(match.knowledgeChunkId);
      if (chunk === undefined) {
        continue;
      }

      const index = indexes.find((item) => item.id === chunk.knowledgeIndexId);
      if (index === undefined) {
        continue;
      }

      const source = await this.deps.knowledge.findSourceById(
        index.knowledgeSourceId,
      );
      if (source === null) {
        continue;
      }

      if (
        filter !== undefined &&
        !knowledgeAttributesMatchFilter(source.attributes, filter)
      ) {
        continue;
      }

      hits.push({
        knowledgeChunkId: chunk.id,
        knowledgeIndexId: index.id,
        knowledgeSourceId: source.id,
        artifactReference: artifactReferenceForSource(source),
        text: chunk.text,
        score: cosineSimilarityFromDistance(match.distance),
        location: chunk.location,
        attributes: source.attributes,
      });
    }

    return hits;
  }
}

function assertCompatibleIndexes(indexes: readonly KnowledgeIndex[]): void {
  const first = indexes[0];
  if (first === undefined) {
    throw new KnowledgeInvalidFilterError("At least one index is required.");
  }

  for (const index of indexes.slice(1)) {
    if (
      index.embeddingProvider !== first.embeddingProvider ||
      index.embeddingModel !== first.embeddingModel ||
      index.embeddingDimensions !== first.embeddingDimensions ||
      index.distanceMetric !== first.distanceMetric
    ) {
      throw new KnowledgeIncompatibleIndexesError();
    }
  }
}

function cosineSimilarityFromDistance(distance: number): number {
  return 1 - distance;
}
