import type { OfficeThreadId } from "@osva-ai/contracts";
import type {
  inboxListResourceSchema,
  inboxReadStateMutationResourceSchema,
  updateInboxReadStateRequestSchema,
} from "@osva-ai/contracts/schemas";
import type { z } from "zod";

import type { OsvaHttpClient } from "../http-client.js";

type InboxListResource = z.infer<typeof inboxListResourceSchema>;
type InboxReadStateMutationResource = z.infer<
  typeof inboxReadStateMutationResourceSchema
>;
type UpdateInboxReadStateRequest = z.infer<
  typeof updateInboxReadStateRequestSchema
>;

export class OfficeInboxResource {
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
    return this.client.request<InboxListResource>({
      method: "GET",
      path: `/v1/office/inbox${suffix}`,
    });
  }

  updateReadState(input: UpdateInboxReadStateRequest) {
    return this.client.request<InboxReadStateMutationResource>({
      method: "PATCH",
      path: "/v1/office/inbox/read-state",
      body: input,
    });
  }

  markThreadRead(threadId: OfficeThreadId, lastReadSequence: number) {
    return this.updateReadState({ threadId, lastReadSequence });
  }
}
