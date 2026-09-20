import { describe, expect, it } from "vitest";

import { DeterministicEmbeddingProviderAdapter } from "../src/deterministic-adapter.js";
import { EmbeddingGateway } from "../src/embedding-gateway.js";

describe("DeterministicEmbeddingProviderAdapter", () => {
  const adapter = new DeterministicEmbeddingProviderAdapter();

  it("returns normalized vectors with configured dimensions", async () => {
    const vectors = await adapter.embed({
      texts: ["hello", "world"],
      model: "test",
      dimensions: 8,
    });
    expect(vectors).toHaveLength(2);
    for (const vector of vectors) {
      expect(vector).toHaveLength(8);
      const magnitude = Math.sqrt(
        vector.reduce((sum, value) => sum + value * value, 0),
      );
      expect(magnitude).toBeCloseTo(1, 5);
    }
  });

  it("is deterministic for the same text", async () => {
    const first = await adapter.embed({
      texts: ["stable"],
      model: "test",
      dimensions: 16,
    });
    const second = await adapter.embed({
      texts: ["stable"],
      model: "test",
      dimensions: 16,
    });
    expect(first[0]).toEqual(second[0]);
  });
});

describe("EmbeddingGateway", () => {
  it("embeds documents through a registered provider", async () => {
    const gateway = new EmbeddingGateway({
      providers: {
        DETERMINISTIC: new DeterministicEmbeddingProviderAdapter(),
      },
    });
    const result = await gateway.embedDocuments({
      provider: "DETERMINISTIC",
      model: "test",
      dimensions: 4,
      texts: ["a", "b"],
    });
    expect(result.vectors).toHaveLength(2);
    expect(result.vectors[0]).toHaveLength(4);
  });
});
