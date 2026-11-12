import type { OfficeMessageId, OfficeThreadId } from "@osva-ai/contracts";
import type {
  createOfficeMessageRequestSchema,
  createOfficeThreadRequestSchema,
  officeMessageListResourceSchema,
  officeMessageResourceSchema,
  officeThreadListResourceSchema,
  officeThreadResourceSchema,
} from "@osva-ai/contracts/schemas";
import type { z } from "zod";

import type { OsvaHttpClient } from "../http-client.js";

type OfficeThreadResource = z.infer<typeof officeThreadResourceSchema>;
type OfficeThreadListResource = z.infer<typeof officeThreadListResourceSchema>;
type OfficeMessageResource = z.infer<typeof officeMessageResourceSchema>;
type OfficeMessageListResource = z.infer<
  typeof officeMessageListResourceSchema
>;
type CreateOfficeThreadRequest = z.infer<
  typeof createOfficeThreadRequestSchema
>;
type CreateOfficeMessageRequest = z.infer<
  typeof createOfficeMessageRequestSchema
>;

export class OfficeThreadsResource {
  constructor(private readonly client: OsvaHttpClient) {}

  list(query?: { readonly cursor?: string; readonly limit?: number }) {
    const params = new URLSearchParams();
    if (query?.cursor !== undefined) {
      params.set("cursor", query.cursor);
    }
    if (query?.limit !== undefined) {
      params.set("limit", String(query.limit));
    }
    const suffix = params.size > 0 ? `?${params.toString()}` : "";
    return this.client.request<OfficeThreadListResource>({
      method: "GET",
      path: `/v1/office/threads${suffix}`,
    });
  }

  create(input: CreateOfficeThreadRequest) {
    return this.client.request<OfficeThreadResource>({
      method: "POST",
      path: "/v1/office/threads",
      body: input,
    });
  }

  get(threadId: OfficeThreadId) {
    return this.client.request<OfficeThreadResource>({
      method: "GET",
      path: `/v1/office/threads/${encodeURIComponent(threadId)}`,
    });
  }

  listMessages(
    threadId: OfficeThreadId,
    query?: { readonly cursor?: string; readonly limit?: number },
  ) {
    const params = new URLSearchParams();
    if (query?.cursor !== undefined) {
      params.set("cursor", query.cursor);
    }
    if (query?.limit !== undefined) {
      params.set("limit", String(query.limit));
    }
    const suffix = params.size > 0 ? `?${params.toString()}` : "";
    return this.client.request<OfficeMessageListResource>({
      method: "GET",
      path: `/v1/office/threads/${encodeURIComponent(threadId)}/messages${suffix}`,
    });
  }

  postMessage(threadId: OfficeThreadId, input: CreateOfficeMessageRequest) {
    return this.client.request<OfficeMessageResource>({
      method: "POST",
      path: `/v1/office/threads/${encodeURIComponent(threadId)}/messages`,
      body: input,
    });
  }

  postReply(
    threadId: OfficeThreadId,
    parentMessageId: OfficeMessageId,
    body: string,
    input?: Omit<CreateOfficeMessageRequest, "body" | "parentMessageId">,
  ) {
    return this.postMessage(threadId, {
      ...input,
      body,
      parentMessageId,
    });
  }
}
