import type { KnowledgeSourceId, WorkspaceId } from "@osva/contracts";
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
  constructor(
    private readonly client: OsvaHttpClient,
    private readonly workspaceId: WorkspaceId,
  ) {}

  list(
    query: Omit<ListKnowledgeSourcesQuery, "workspaceId"> = {},
  ): Promise<KnowledgeSourceListResource> {
    return this.client.request({
      method: "GET",
      path: "/v1/knowledge-sources",
      query: {
        workspaceId: this.workspaceId,
        limit: query.limit,
        cursor: query.cursor,
      },
    });
  }

  get(knowledgeSourceId: KnowledgeSourceId): Promise<KnowledgeSourceResource> {
    return this.client.request({
      method: "GET",
      path: `/v1/knowledge-sources/${encodeURIComponent(knowledgeSourceId)}`,
      query: { workspaceId: this.workspaceId },
    });
  }

  create(
    input: Omit<CreateKnowledgeSourceRequest, "workspaceId">,
  ): Promise<KnowledgeSourceResource> {
    const body: CreateKnowledgeSourceRequest = {
      workspaceId: this.workspaceId,
      ...input,
    };
    const headers: Record<string, string> = {};
    if (input.idempotencyKey !== undefined) {
      headers["Idempotency-Key"] = input.idempotencyKey;
    }
    return this.client.request({
      method: "POST",
      path: "/v1/knowledge-sources",
      body,
      headers,
    });
  }
}
