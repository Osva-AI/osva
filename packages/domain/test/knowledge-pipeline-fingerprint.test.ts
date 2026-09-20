import { describe, expect, it } from "vitest";

import { computeKnowledgePipelineFingerprint } from "../src/knowledge-pipeline-fingerprint.js";

describe("computeKnowledgePipelineFingerprint", () => {
  it("changes when chunk size changes", () => {
    const base = {
      parserKey: "osva_native_v1",
      parserVersion: "1",
      chunkerKey: "recursive_text_v1",
      chunkerVersion: "1",
      chunkSize: 1500,
      chunkOverlap: 200,
      embeddingProvider: "DETERMINISTIC",
      embeddingModel: "deterministic-v1",
      embeddingDimensions: 384,
      distanceMetric: "COSINE" as const,
    };

    const first = computeKnowledgePipelineFingerprint(base);
    const second = computeKnowledgePipelineFingerprint({
      ...base,
      chunkSize: 1200,
    });

    expect(first).not.toEqual(second);
  });
});
