import type { KnowledgeSourceId } from "@osva/contracts";
import {
  createKnowledgeSourceRequestSchema,
  knowledgeSourceResourceSchema,
  listKnowledgeSourcesQuerySchema,
} from "@osva/contracts/schemas";
import type { z } from "zod";

import type { OsvaHttpClient } from "../http-client.js";

type CreateKnowledgeSourceRequest = z.infer<
  typeof createKnowledgeSourceRequestSchema
>;
type KnowledgeSourceResource = z.infer<typeof knowledgeSourceResourceSchema>;
type ListKnowledgeSourcesQuery = z.infer<
  typeof listKnowledgeSourcesQuerySchema
>;

export interface KnowledgeSourceListResource {
  readonly items: readonly KnowledgeSourceResource[];
  readonly nextCursor?: string;
}

export class KnowledgeSourcesResource {
  constructor(private readonly client: OsvaHttpClient) {}

  list(
    query: ListKnowledgeSourcesQuery = {},
  ): Promise<KnowledgeSourceListResource> {
    return this.client.request({
      method: "GET",
      path: "/v1/knowledge-sources",
      query: {
        limit: query.limit,
        cursor: query.cursor,
      },
    });
  }

  get(knowledgeSourceId: KnowledgeSourceId): Promise<KnowledgeSourceResource> {
    return this.client.request({
      method: "GET",
      path: `/v1/knowledge-sources/${encodeURIComponent(knowledgeSourceId)}`,
    });
  }

  create(
    input: CreateKnowledgeSourceRequest,
  ): Promise<KnowledgeSourceResource> {
    const headers: Record<string, string> = {};
    if (input.idempotencyKey !== undefined) {
      headers["Idempotency-Key"] = input.idempotencyKey;
    }
    return this.client.request({
      method: "POST",
      path: "/v1/knowledge-sources",
      body: input,
      headers,
    });
  }
}
