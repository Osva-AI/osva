import type { KnowledgeIndexId, WorkspaceId } from "./ids.js";
import type { JsonObject } from "./json-value.js";
import type { KnowledgeHitV1 } from "./knowledge.js";

export interface KnowledgeRetrieveRequestV1 {
  readonly workspaceId: WorkspaceId;
  readonly knowledgeIndexIds: readonly KnowledgeIndexId[];
  readonly query: string;
  readonly topK?: number;
  readonly filter?: JsonObject;
}

export interface KnowledgeRetrieveResponseV1 {
  readonly hits: readonly KnowledgeHitV1[];
}
