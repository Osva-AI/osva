import type { WorkspaceId } from "@osva/contracts";
import {
  knowledgeRetrieveRequestSchema,
  knowledgeRetrieveResponseSchema,
} from "@osva/contracts/schemas";
import type { z } from "zod";

import type { OsvaHttpClient } from "../http-client.js";

type KnowledgeRetrieveRequest = z.infer<typeof knowledgeRetrieveRequestSchema>;
type KnowledgeRetrieveResponse = z.infer<
  typeof knowledgeRetrieveResponseSchema
>;

export class KnowledgeResource {
  constructor(
    private readonly client: OsvaHttpClient,
    private readonly workspaceId: WorkspaceId,
  ) {}

  retrieve(
    input: Omit<KnowledgeRetrieveRequest, "workspaceId">,
  ): Promise<KnowledgeRetrieveResponse> {
    const body: KnowledgeRetrieveRequest = {
      workspaceId: this.workspaceId,
      ...input,
    };
    return this.client.request({
      method: "POST",
      path: "/v1/knowledge/retrieve",
      body,
    });
  }
}
