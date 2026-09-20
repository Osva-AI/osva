import { KnowledgeEmbeddingFailedError } from "@osva/domain";
import type {
  EmbedDocumentsRequest,
  EmbedQueryRequest,
  EmbeddingGateway as EmbeddingGatewayPort,
  EmbeddingGatewayResult,
} from "@osva/domain";

import type { EmbeddingProviderAdapter } from "./provider-adapter.js";

export interface EmbeddingGatewayDependencies {
  readonly providers: Readonly<Record<string, EmbeddingProviderAdapter>>;
}

export class EmbeddingGateway implements EmbeddingGatewayPort {
  constructor(private readonly deps: EmbeddingGatewayDependencies) {}

  async embedDocuments(
    request: EmbedDocumentsRequest,
  ): Promise<EmbeddingGatewayResult> {
    const adapter = this.resolveAdapter(request.provider);
    const vectors = await adapter.embed({
      texts: request.texts,
      model: request.model,
      dimensions: request.dimensions,
    });
    if (vectors.length !== request.texts.length) {
      throw new KnowledgeEmbeddingFailedError();
    }
    for (const vector of vectors) {
      if (vector.length !== request.dimensions) {
        throw new KnowledgeEmbeddingFailedError();
      }
    }
    return { vectors };
  }

  async embedQuery(request: EmbedQueryRequest): Promise<readonly number[]> {
    const adapter = this.resolveAdapter(request.provider);
    const [vector] = await adapter.embed({
      texts: [request.query],
      model: request.model,
      dimensions: request.dimensions,
    });
    if (vector === undefined || vector.length !== request.dimensions) {
      throw new KnowledgeEmbeddingFailedError();
    }
    return vector;
  }

  private resolveAdapter(provider: string): EmbeddingProviderAdapter {
    const adapter = this.deps.providers[provider];
    if (adapter === undefined) {
      throw new KnowledgeEmbeddingFailedError(
        `Embedding provider '${provider}' is unavailable.`,
      );
    }
    return adapter;
  }
}
