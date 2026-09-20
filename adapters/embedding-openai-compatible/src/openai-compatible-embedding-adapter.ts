import OpenAI from "openai";
import type { EmbeddingProviderAdapter } from "@osva/embedding-gateway";

export interface OpenAiCompatibleEmbeddingAdapterOptions {
  readonly provider: string;
  readonly apiKey: string;
  readonly baseURL?: string;
}

export class OpenAiCompatibleEmbeddingAdapter implements EmbeddingProviderAdapter {
  readonly provider: string;
  private readonly client: OpenAI;

  constructor(options: OpenAiCompatibleEmbeddingAdapterOptions) {
    this.provider = options.provider;
    this.client = new OpenAI({
      apiKey: options.apiKey,
      baseURL: options.baseURL,
    });
  }

  async embed(request: {
    readonly texts: readonly string[];
    readonly model: string;
    readonly dimensions: number;
  }): Promise<readonly (readonly number[])[]> {
    const response = await this.client.embeddings.create({
      model: request.model,
      input: [...request.texts],
      dimensions: request.dimensions,
    });

    return response.data.map((item) => item.embedding);
  }
}
