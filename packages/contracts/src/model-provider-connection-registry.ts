import type {
  ModelProviderConnectionId,
  ModelProviderConnectionVersionId,
  WorkspaceId,
} from "./ids.js";
import type { ModelProvider } from "./model-gateway.js";
import type {
  ModelProviderConnectionTestResult,
  PublicModelProviderConnectionEndpointV1,
  PublicModelProviderCredentialV1,
} from "./model-provider-connection.js";

export interface CreateModelProviderConnectionRequestV1 {
  readonly key: string;
  readonly name: string;
  readonly provider: ModelProvider;
}

export interface UpdateModelProviderConnectionRequestV1 {
  readonly name: string;
}

export interface CreateModelProviderConnectionVersionRequestV1 {
  readonly endpoint?: PublicModelProviderConnectionEndpointV1;
  readonly credentialRef?: { readonly key: string };
}

export interface ModelProviderConnectionResourceV1 {
  readonly id: ModelProviderConnectionId;
  readonly workspaceId: WorkspaceId;
  readonly key: string;
  readonly name: string;
  readonly provider: ModelProvider;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ModelProviderConnectionVersionResourceV1 {
  readonly id: ModelProviderConnectionVersionId;
  readonly connectionId: ModelProviderConnectionId;
  readonly version: number;
  readonly provider: ModelProvider;
  readonly endpoint?: PublicModelProviderConnectionEndpointV1;
  readonly credential?: PublicModelProviderCredentialV1;
  readonly createdAt: string;
}

export interface ModelProviderConnectionListResourceV1 {
  readonly connections: readonly ModelProviderConnectionResourceV1[];
}

export interface ModelProviderConnectionVersionListResourceV1 {
  readonly versions: readonly ModelProviderConnectionVersionResourceV1[];
}

export type ModelProviderConnectionTestResourceV1 =
  ModelProviderConnectionTestResult;

export interface ModelProviderConnectionTestRequestV1 {
  readonly model?: string;
  readonly modelProfileVersionId?: string;
}
