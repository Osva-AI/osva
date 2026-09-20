import type { KnowledgeEmbeddingDefaults } from "./knowledge-pipeline-config.js";

export function loadKnowledgeEmbeddingDefaults(
  env: NodeJS.ProcessEnv = process.env,
): KnowledgeEmbeddingDefaults {
  const provider = env.OSVA_KNOWLEDGE_EMBEDDING_PROVIDER?.trim();
  if (provider === undefined || provider.length === 0) {
    if (
      env.NODE_ENV === "test" ||
      env.VITEST === "true" ||
      env.OSVA_ALLOW_DETERMINISTIC_EMBEDDINGS === "true"
    ) {
      return {
        provider: "DETERMINISTIC",
        model: env.OSVA_KNOWLEDGE_EMBEDDING_MODEL?.trim() || "deterministic-v1",
        dimensions: parsePositiveInt(
          env.OSVA_KNOWLEDGE_EMBEDDING_DIMENSIONS,
          384,
        ),
      };
    }
    throw new Error(
      "OSVA_KNOWLEDGE_EMBEDDING_PROVIDER is required for knowledge indexing.",
    );
  }
  const model =
    env.OSVA_KNOWLEDGE_EMBEDDING_MODEL?.trim() || "deterministic-v1";
  const dimensions = parsePositiveInt(
    env.OSVA_KNOWLEDGE_EMBEDDING_DIMENSIONS,
    384,
  );

  return { provider, model, dimensions };
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const trimmed = value?.trim() ?? "";
  if (trimmed.length === 0) {
    return fallback;
  }
  const parsed = Number.parseInt(trimmed, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(
      "OSVA_KNOWLEDGE_EMBEDDING_DIMENSIONS must be a positive integer.",
    );
  }
  return parsed;
}
