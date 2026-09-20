import type { ArtifactId, WorkspaceId } from "./ids.js";
import type {
  KnowledgeIndexResourceV1,
  KnowledgeSourceResourceV1,
} from "./knowledge.js";
import type { JsonObject } from "./json-value.js";

export interface CreateKnowledgeSourceRequestV1 {
  readonly workspaceId: WorkspaceId;
  readonly key: string;
  readonly name: string;
  readonly artifactId: ArtifactId;
  readonly attributes?: JsonObject;
  readonly idempotencyKey?: string;
}

export interface KnowledgeSourceListResourceV1 {
  readonly items: readonly KnowledgeSourceResourceV1[];
  readonly nextCursor?: string;
}

export interface ListKnowledgeSourcesQueryV1 {
  readonly workspaceId: WorkspaceId;
  readonly limit?: number;
  readonly cursor?: string;
}

export interface CreateKnowledgeIndexRequestV1 {
  readonly workspaceId: WorkspaceId;
  readonly idempotencyKey?: string;
}

export interface KnowledgeIndexListResourceV1 {
  readonly items: readonly KnowledgeIndexResourceV1[];
  readonly nextCursor?: string;
}

export interface ListKnowledgeIndexesQueryV1 {
  readonly workspaceId: WorkspaceId;
  readonly limit?: number;
  readonly cursor?: string;
}

export interface RetryKnowledgeIndexRequestV1 {
  readonly workspaceId: WorkspaceId;
}
