import type { KnowledgeIndexId, WorkspaceId } from "@osva/contracts";
import { describe, expect, it, vi } from "vitest";

import { KnowledgeIncompatibleIndexesError } from "../src/errors.js";
import { KnowledgeIndex } from "../src/knowledge-index.js";
import { computeKnowledgePipelineFingerprint } from "../src/knowledge-pipeline-fingerprint.js";
import { resolveDefaultKnowledgePipeline } from "../src/knowledge-pipeline-config.js";
import { KnowledgeRetriever } from "../src/knowledge-retriever.js";

const NOW = new Date("2026-02-01T12:00:00.000Z");
const WORKSPACE_ID = "ws-retrieve" as WorkspaceId;

function readyIndex(id: string, dimensions: number): KnowledgeIndex {
  const pipeline = resolveDefaultKnowledgePipeline({
    provider: "DETERMINISTIC",
    model: "test",
    dimensions,
  });
  return KnowledgeIndex.rehydrate({
    id: id as KnowledgeIndexId,
    workspaceId: WORKSPACE_ID,
    knowledgeSourceId: "ks-1" as never,
    status: "READY",
    ...pipeline,
    pipelineFingerprint: computeKnowledgePipelineFingerprint(pipeline),
    attemptCount: 1,
    chunkCount: 1,
    embeddedChunkCount: 1,
    createdAt: NOW,
    updatedAt: NOW,
    readyAt: NOW,
  });
}

describe("KnowledgeRetriever compatibility", () => {
  it("rejects incompatible embedding dimensions before vector search", async () => {
    const query = vi.fn();
    const retriever = new KnowledgeRetriever({
      knowledge: {
        findIndexById: async (id: KnowledgeIndexId) =>
          id === "ki-a" ? readyIndex("ki-a", 4) : readyIndex("ki-b", 8),
      } as never,
      embeddings: {
        embedQuery: async () => [],
        embedDocuments: async () => ({ vectors: [] }),
      } as never,
      vectorStore: {
        query,
        upsert: async () => undefined,
        countForIndex: async () => 0,
      } as never,
    });

    await expect(
      retriever.retrieve({
        workspaceId: WORKSPACE_ID,
        knowledgeIndexIds: [
          "ki-a" as KnowledgeIndexId,
          "ki-b" as KnowledgeIndexId,
        ],
        query: "hello",
      }),
    ).rejects.toBeInstanceOf(KnowledgeIncompatibleIndexesError);
    expect(query).not.toHaveBeenCalled();
  });
});
