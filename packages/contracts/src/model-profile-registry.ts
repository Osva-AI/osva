import type {
  ModelProfileId,
  ModelProfileVersionId,
  WorkspaceId,
} from "./ids.js";
import type { ModelProvider } from "./model-gateway.js";

export interface CreateModelProfileRequestV1 {
  readonly workspaceId: WorkspaceId;
  readonly key: string;
  readonly name: string;
}

export interface UpdateModelProfileRequestV1 {
  readonly name: string;
}

export interface CreateModelProfileVersionRequestV1 {
  readonly provider: ModelProvider;
  readonly model: string;
}

export interface ModelProfileResourceV1 {
  readonly id: ModelProfileId;
  readonly workspaceId: WorkspaceId;
  readonly key: string;
  readonly name: string;
  readonly createdAt: string;
}

export interface ModelProfileVersionResourceV1 {
  readonly id: ModelProfileVersionId;
  readonly modelProfileId: ModelProfileId;
  readonly version: number;
  readonly provider: ModelProvider;
  readonly model: string;
  readonly createdAt: string;
}

export interface ModelProfileListResourceV1 {
  readonly modelProfiles: readonly ModelProfileResourceV1[];
}

export interface ModelProfileVersionListResourceV1 {
  readonly versions: readonly ModelProfileVersionResourceV1[];
}
