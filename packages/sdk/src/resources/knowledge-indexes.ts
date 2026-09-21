import type { KnowledgeIndexId, KnowledgeSourceId } from "@osva/contracts";
import {
  createKnowledgeIndexRequestSchema,
  knowledgeIndexResourceSchema,
} from "@osva/contracts/schemas";
import type { z } from "zod";

import type { OsvaHttpClient } from "../http-client.js";

type CreateKnowledgeIndexRequest = z.infer<
  typeof createKnowledgeIndexRequestSchema
>;
type KnowledgeIndexResource = z.infer<typeof knowledgeIndexResourceSchema>;

export interface KnowledgeIndexListResource {
  readonly items: readonly KnowledgeIndexResource[];
  readonly nextCursor?: string;
}

export class KnowledgeIndexesResource {
  constructor(private readonly client: OsvaHttpClient) {}

  listForSource(
    knowledgeSourceId: KnowledgeSourceId,
    query: { readonly limit?: number; readonly cursor?: string } = {},
  ): Promise<KnowledgeIndexListResource> {
    return this.client.request({
      method: "GET",
      path: `/v1/knowledge-sources/${encodeURIComponent(knowledgeSourceId)}/indexes`,
      query: {
        limit: query.limit === undefined ? undefined : String(query.limit),
        cursor: query.cursor,
      },
    });
  }

  get(knowledgeIndexId: KnowledgeIndexId): Promise<KnowledgeIndexResource> {
    return this.client.request({
      method: "GET",
      path: `/v1/knowledge-indexes/${encodeURIComponent(knowledgeIndexId)}`,
    });
  }

  createForSource(
    knowledgeSourceId: KnowledgeSourceId,
    input: CreateKnowledgeIndexRequest = {},
  ): Promise<KnowledgeIndexResource> {
    const headers: Record<string, string> = {};
    if (input.idempotencyKey !== undefined) {
      headers["Idempotency-Key"] = input.idempotencyKey;
    }
    return this.client.request({
      method: "POST",
      path: `/v1/knowledge-sources/${encodeURIComponent(knowledgeSourceId)}/indexes`,
      body: input,
      headers,
    });
  }

  retry(knowledgeIndexId: KnowledgeIndexId): Promise<KnowledgeIndexResource> {
    return this.client.request({
      method: "POST",
      path: `/v1/knowledge-indexes/${encodeURIComponent(knowledgeIndexId)}/retry`,
      body: {},
    });
  }
}
