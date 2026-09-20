import { describe, expect, it } from "vitest";

import { loadKnowledgeEmbeddingDefaults } from "../src/knowledge-config.js";

describe("loadKnowledgeEmbeddingDefaults", () => {
  it("requires an explicit provider outside test/dev allowances", () => {
    expect(() => loadKnowledgeEmbeddingDefaults({})).toThrow(
      "OSVA_KNOWLEDGE_EMBEDDING_PROVIDER is required",
    );
  });

  it("allows deterministic embeddings in test", () => {
    const defaults = loadKnowledgeEmbeddingDefaults({ NODE_ENV: "test" });
    expect(defaults.provider).toBe("DETERMINISTIC");
  });

  it("uses configured production provider when set", () => {
    const defaults = loadKnowledgeEmbeddingDefaults({
      OSVA_KNOWLEDGE_EMBEDDING_PROVIDER: "OPENAI_COMPATIBLE",
      OSVA_KNOWLEDGE_EMBEDDING_MODEL: "text-embedding-3-small",
      OSVA_KNOWLEDGE_EMBEDDING_DIMENSIONS: "1536",
    });
    expect(defaults.provider).toBe("OPENAI_COMPATIBLE");
    expect(defaults.dimensions).toBe(1536);
  });
});
