import type {
  KnowledgeIndexId,
  KnowledgeSourceId,
  WorkspaceId,
} from "@osva/contracts";
import { describe, expect, it, vi } from "vitest";

import {
  KnowledgeIndexNotFoundError,
  KnowledgeIndexNotRetryableError,
} from "../src/errors.js";
import { KnowledgeIndex } from "../src/knowledge-index.js";
import { computeKnowledgePipelineFingerprint } from "../src/knowledge-pipeline-fingerprint.js";
import { resolveDefaultKnowledgePipeline } from "../src/knowledge-pipeline-config.js";
import { createKnowledgeApplication } from "../src/knowledge-application.js";
import type { KnowledgeRepository } from "../src/ports/knowledge-repository.js";

const NOW = new Date("2026-02-01T12:00:00.000Z");
const WORKSPACE_ID = "ws-retry" as WorkspaceId;
const INDEX_ID = "ki-retry" as KnowledgeIndexId;
const SOURCE_ID = "ks-retry" as KnowledgeSourceId;

function createIndex(status: KnowledgeIndex["status"]): KnowledgeIndex {
  const pipeline = resolveDefaultKnowledgePipeline({
    provider: "DETERMINISTIC",
    model: "test",
    dimensions: 8,
  });
  return KnowledgeIndex.rehydrate({
    id: INDEX_ID,
    workspaceId: WORKSPACE_ID,
    knowledgeSourceId: SOURCE_ID,
    status,
    ...pipeline,
    pipelineFingerprint: computeKnowledgePipelineFingerprint(pipeline),
    attemptCount: 1,
    createdAt: NOW,
    updatedAt: NOW,
  });
}

describe("RetryKnowledgeIndex", () => {
  it("returns NOT_FOUND for a missing index", async () => {
    const knowledge: KnowledgeRepository = {
      findIndexById: async () => null,
    } as unknown as KnowledgeRepository;
    const app = createKnowledgeApplication({
      knowledge,
      artifacts: {} as never,
      workspaces: {} as never,
      indexQueue: { enqueue: async () => undefined } as never,
      embeddingDefaults: {
        provider: "DETERMINISTIC",
        model: "test",
        dimensions: 8,
      },
      clock: { now: () => NOW },
      ids: { createId: () => "id" },
    });

    await expect(
      app.retryIndex.execute(WORKSPACE_ID, INDEX_ID),
    ).rejects.toBeInstanceOf(KnowledgeIndexNotFoundError);
  });

  it("retries FAILED indexes to PENDING and enqueues work", async () => {
    let stored = createIndex("FAILED");
    const enqueue = vi.fn(async () => undefined);
    const knowledge: KnowledgeRepository = {
      findIndexById: async () => stored,
      updateIndex: async (index: KnowledgeIndex) => {
        stored = index;
      },
    } as unknown as KnowledgeRepository;
    const app = createKnowledgeApplication({
      knowledge,
      artifacts: {} as never,
      workspaces: {} as never,
      indexQueue: { enqueue } as never,
      embeddingDefaults: {
        provider: "DETERMINISTIC",
        model: "test",
        dimensions: 8,
      },
      clock: { now: () => NOW },
      ids: { createId: () => "id" },
    });

    const retried = await app.retryIndex.execute(WORKSPACE_ID, INDEX_ID);
    expect(retried.status).toBe("PENDING");
    expect(enqueue).toHaveBeenCalledWith(INDEX_ID);
  });

  for (const status of ["PENDING", "RUNNING", "READY"] as const) {
    it(`rejects retry from ${status}`, async () => {
      const knowledge: KnowledgeRepository = {
        findIndexById: async () => createIndex(status),
      } as unknown as KnowledgeRepository;
      const app = createKnowledgeApplication({
        knowledge,
        artifacts: {} as never,
        workspaces: {} as never,
        indexQueue: { enqueue: async () => undefined } as never,
        embeddingDefaults: {
          provider: "DETERMINISTIC",
          model: "test",
          dimensions: 8,
        },
        clock: { now: () => NOW },
        ids: { createId: () => "id" },
      });

      await expect(
        app.retryIndex.execute(WORKSPACE_ID, INDEX_ID),
      ).rejects.toBeInstanceOf(KnowledgeIndexNotRetryableError);
    });
  }
});
