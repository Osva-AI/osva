import { describe, expect, it } from "vitest";

import { KnowledgeIndex } from "../src/knowledge-index.js";
import { InvalidKnowledgeIndexTransitionError } from "../src/errors.js";

describe("KnowledgeIndex lifecycle", () => {
  it("rejects transitions from READY", () => {
    const index = KnowledgeIndex.rehydrate({
      id: "idx-1" as KnowledgeIndex["id"],
      workspaceId: "ws-1" as KnowledgeIndex["workspaceId"],
      knowledgeSourceId: "src-1" as KnowledgeIndex["knowledgeSourceId"],
      status: "READY",
      parserKey: "osva_native_v1",
      parserVersion: "1",
      chunkerKey: "recursive_text_v1",
      chunkerVersion: "1",
      chunkSize: 1500,
      chunkOverlap: 200,
      embeddingProvider: "DETERMINISTIC",
      embeddingModel: "deterministic-v1",
      embeddingDimensions: 384,
      distanceMetric: "COSINE",
      pipelineFingerprint: "sha256:abc",
      attemptCount: 1,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      updatedAt: new Date("2026-01-01T00:00:00.000Z"),
      readyAt: new Date("2026-01-01T00:00:00.000Z"),
    });

    expect(() =>
      index.transitionTo("FAILED", {
        updatedAt: new Date("2026-01-02T00:00:00.000Z"),
      }),
    ).toThrow(InvalidKnowledgeIndexTransitionError);
  });

  it("allows FAILED to PENDING for retry", () => {
    const index = KnowledgeIndex.rehydrate({
      id: "idx-1" as KnowledgeIndex["id"],
      workspaceId: "ws-1" as KnowledgeIndex["workspaceId"],
      knowledgeSourceId: "src-1" as KnowledgeIndex["knowledgeSourceId"],
      status: "FAILED",
      parserKey: "osva_native_v1",
      parserVersion: "1",
      chunkerKey: "recursive_text_v1",
      chunkerVersion: "1",
      chunkSize: 1500,
      chunkOverlap: 200,
      embeddingProvider: "DETERMINISTIC",
      embeddingModel: "deterministic-v1",
      embeddingDimensions: 384,
      distanceMetric: "COSINE",
      pipelineFingerprint: "sha256:abc",
      attemptCount: 2,
      lastErrorCode: "KNOWLEDGE_EXTRACTION_FAILED",
      lastErrorMessage: "failed",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    });

    const retried = index.transitionTo("PENDING", {
      updatedAt: new Date("2026-01-02T00:00:00.000Z"),
      lastErrorCode: null,
      lastErrorMessage: null,
    });
    expect(retried.status).toBe("PENDING");
  });
});
