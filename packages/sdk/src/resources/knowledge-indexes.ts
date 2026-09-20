import type {
  KnowledgeIndexId,
  KnowledgeSourceId,
  WorkspaceId,
} from "@osva/contracts";
import {
  createKnowledgeIndexRequestSchema,
  knowledgeIndexResourceSchema,
  retryKnowledgeIndexRequestSchema,
} from "@osva/contracts/schemas";
import type { z } from "zod";

import type { OsvaHttpClient } from "../http-client.js";

type CreateKnowledgeIndexRequest = z.infer<
  typeof createKnowledgeIndexRequestSchema
>;
type KnowledgeIndexResource = z.infer<typeof knowledgeIndexResourceSchema>;
type RetryKnowledgeIndexRequest = z.infer<
  typeof retryKnowledgeIndexRequestSchema
>;

export interface KnowledgeIndexListResource {
  readonly items: readonly KnowledgeIndexResource[];
  readonly nextCursor?: string;
}

export class KnowledgeIndexesResource {
  constructor(
    private readonly client: OsvaHttpClient,
    private readonly workspaceId: WorkspaceId,
  ) {}

  listForSource(
    knowledgeSourceId: KnowledgeSourceId,
    query: { readonly limit?: number; readonly cursor?: string } = {},
  ): Promise<KnowledgeIndexListResource> {
    const params = new URLSearchParams();
    params.set("workspaceId", this.workspaceId);
    if (query.limit !== undefined) {
      params.set("limit", String(query.limit));
    }
    if (query.cursor !== undefined) {
      params.set("cursor", query.cursor);
    }
    const suffix = `?${params.toString()}`;
    return this.client.request({
      method: "GET",
      path: `/v1/knowledge-sources/${encodeURIComponent(knowledgeSourceId)}/indexes${suffix}`,
    });
  }

  get(knowledgeIndexId: KnowledgeIndexId): Promise<KnowledgeIndexResource> {
    return this.client.request({
      method: "GET",
      path: `/v1/knowledge-indexes/${encodeURIComponent(knowledgeIndexId)}`,
      query: { workspaceId: this.workspaceId },
    });
  }

  createForSource(
    knowledgeSourceId: KnowledgeSourceId,
    input: Omit<CreateKnowledgeIndexRequest, "workspaceId"> = {},
  ): Promise<KnowledgeIndexResource> {
    const body: CreateKnowledgeIndexRequest = {
      workspaceId: this.workspaceId,
      ...input,
    };
    const headers: Record<string, string> = {};
    if (input.idempotencyKey !== undefined) {
      headers["Idempotency-Key"] = input.idempotencyKey;
    }
    return this.client.request({
      method: "POST",
      path: `/v1/knowledge-sources/${encodeURIComponent(knowledgeSourceId)}/indexes`,
      body,
      headers,
    });
  }

  retry(knowledgeIndexId: KnowledgeIndexId): Promise<KnowledgeIndexResource> {
    const body: RetryKnowledgeIndexRequest = {
      workspaceId: this.workspaceId,
    };
    return this.client.request({
      method: "POST",
      path: `/v1/knowledge-indexes/${encodeURIComponent(knowledgeIndexId)}/retry`,
      body,
    });
  }
}
