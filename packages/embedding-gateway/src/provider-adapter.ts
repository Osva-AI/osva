export interface EmbeddingProviderEmbedRequest {
  readonly texts: readonly string[];
  readonly model: string;
  readonly dimensions: number;
}

export interface EmbeddingProviderAdapter {
  readonly provider: string;
  embed(
    request: EmbeddingProviderEmbedRequest,
  ): Promise<readonly (readonly number[])[]>;
}
