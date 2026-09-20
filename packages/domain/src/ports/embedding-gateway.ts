export interface EmbedDocumentsRequest {
  readonly texts: readonly string[];
  readonly provider: string;
  readonly model: string;
  readonly dimensions: number;
}

export interface EmbedQueryRequest {
  readonly query: string;
  readonly provider: string;
  readonly model: string;
  readonly dimensions: number;
}

export interface EmbeddingGatewayResult {
  readonly vectors: readonly (readonly number[])[];
}

export interface EmbeddingGateway {
  embedDocuments(
    request: EmbedDocumentsRequest,
  ): Promise<EmbeddingGatewayResult>;
  embedQuery(request: EmbedQueryRequest): Promise<readonly number[]>;
}
