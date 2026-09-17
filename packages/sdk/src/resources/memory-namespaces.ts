import type { MemoryNamespaceId } from "@osva/contracts";
import {
  createMemoryNamespaceRequestSchema,
  listMemoryRecordsQuerySchema,
  memoryNamespaceListResourceSchema,
  memoryNamespaceResourceSchema,
  memoryRecordListResourceSchema,
} from "@osva/contracts/schemas";
import type { z } from "zod";

import type { OsvaHttpClient } from "../http-client.js";

type CreateMemoryNamespaceRequest = z.infer<
  typeof createMemoryNamespaceRequestSchema
>;
type MemoryNamespaceListResource = z.infer<
  typeof memoryNamespaceListResourceSchema
>;
type MemoryNamespaceResource = z.infer<typeof memoryNamespaceResourceSchema>;
type MemoryRecordListResource = z.infer<typeof memoryRecordListResourceSchema>;
type ListMemoryRecordsQuery = z.infer<typeof listMemoryRecordsQuerySchema>;

export class MemoryNamespacesResource {
  constructor(private readonly client: OsvaHttpClient) {}

  list(): Promise<MemoryNamespaceListResource> {
    return this.client.request({
      method: "GET",
      path: "/v1/memory-namespaces",
    });
  }

  get(namespaceId: MemoryNamespaceId): Promise<MemoryNamespaceResource> {
    return this.client.request({
      method: "GET",
      path: `/v1/memory-namespaces/${encodeURIComponent(namespaceId)}`,
    });
  }

  create(
    input: CreateMemoryNamespaceRequest,
  ): Promise<MemoryNamespaceResource> {
    return this.client.request({
      method: "POST",
      path: "/v1/memory-namespaces",
      body: input,
    });
  }

  listRecords(
    namespaceId: MemoryNamespaceId,
    query: ListMemoryRecordsQuery = {},
  ): Promise<MemoryRecordListResource> {
    const params = new URLSearchParams();
    if (query.prefix !== undefined) {
      params.set("prefix", query.prefix);
    }
    if (query.limit !== undefined) {
      params.set("limit", String(query.limit));
    }
    if (query.cursor !== undefined) {
      params.set("cursor", query.cursor);
    }
    const suffix = params.size > 0 ? `?${params.toString()}` : "";
    return this.client.request({
      method: "GET",
      path: `/v1/memory-namespaces/${encodeURIComponent(namespaceId)}/records${suffix}`,
    });
  }
}
