import { describe, expect, it } from "vitest";

import { chunkKnowledgeText } from "../src/knowledge-chunker.js";

describe("chunkKnowledgeText", () => {
  it("produces deterministic chunks for the same extraction", () => {
    const segments = [
      { ordinal: 1, text: "Alpha paragraph.\n\nBeta paragraph." },
      { ordinal: 2, text: "Gamma paragraph." },
    ];

    const first = chunkKnowledgeText({
      segments,
      chunkSize: 40,
      chunkOverlap: 5,
    });
    const second = chunkKnowledgeText({
      segments,
      chunkSize: 40,
      chunkOverlap: 5,
    });

    expect(first).toEqual(second);
    expect(first.length).toBeGreaterThan(0);
    expect(first.every((chunk) => chunk.text.trim().length > 0)).toBe(true);
  });
});
