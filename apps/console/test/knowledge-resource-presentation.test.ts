import { describe, expect, it } from "vitest";

import {
  formatKnowledgeHitLocation,
  formatKnowledgeIndexStatusLabel,
  summarizeSourceIndexReadiness,
} from "../src/client/lib/knowledge-resource-presentation";
import type { KnowledgeHitResource } from "../src/client/hooks/use-knowledge-memory";

describe("knowledge-resource-presentation", () => {
  it("formats index lifecycle states from API enums", () => {
    expect(formatKnowledgeIndexStatusLabel("PENDING")).toBe("Pending");
    expect(formatKnowledgeIndexStatusLabel("RUNNING")).toBe("Running");
    expect(formatKnowledgeIndexStatusLabel("READY")).toBe("Ready");
    expect(formatKnowledgeIndexStatusLabel("FAILED")).toBe("Failed");
  });

  it("summarizes source readiness from index list", () => {
    expect(summarizeSourceIndexReadiness([]).headline).toBe("Not indexed");
    const summary = summarizeSourceIndexReadiness([
      {
        id: "ki-1",
        workspaceId: "ws-1",
        knowledgeSourceId: "ks-1",
        status: "READY",
        parserKey: "p",
        parserVersion: "1",
        chunkerKey: "c",
        chunkerVersion: "1",
        chunkSize: 512,
        chunkOverlap: 64,
        embeddingProvider: "openai",
        embeddingModel: "e",
        embeddingDimensions: 1536,
        distanceMetric: "COSINE",
        pipelineFingerprint: "fp",
        attemptCount: 1,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-02T00:00:00.000Z",
        readyAt: "2026-01-02T00:00:00.000Z",
      },
    ]);
    expect(summary.readyCount).toBe(1);
    expect(summary.total).toBe(1);
  });

  it("formats hit location from backend fields", () => {
    const hit: KnowledgeHitResource = {
      knowledgeChunkId: "kc-1",
      knowledgeIndexId: "ki-1",
      knowledgeSourceId: "ks-1",
      text: "excerpt",
      score: 0.9,
      attributes: {},
      location: { page: 2, heading: "Intro" },
    };
    expect(formatKnowledgeHitLocation(hit)).toBe("page 2 · Intro");
  });
});
