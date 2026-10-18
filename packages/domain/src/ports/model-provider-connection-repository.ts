import type {
  ModelProviderConnectionEndpoint,
  ModelProviderConnectionId,
  ModelProviderConnectionVersionId,
  SecretReference,
  WorkspaceId,
} from "@osva-ai/contracts";

import type { ModelProviderConnection } from "../model-provider-connection.js";
import type { ModelProviderConnectionVersion } from "../model-provider-connection-version.js";

export interface ModelProviderConnectionMetadataUpdate {
  readonly name: string;
  readonly updatedAt: Date;
}

export interface AppendModelProviderConnectionVersionInput {
  readonly id: ModelProviderConnectionVersionId;
  readonly connectionId: ModelProviderConnectionId;
  readonly endpoint?: ModelProviderConnectionEndpoint;
  readonly credentialRef?: SecretReference;
  readonly createdAt: Date;
}

export interface ModelProviderConnectionRepository {
  saveConnection(connection: ModelProviderConnection): Promise<void>;
  findConnectionById(
    id: ModelProviderConnectionId,
  ): Promise<ModelProviderConnection | null>;
  findConnectionByWorkspaceAndId(
    workspaceId: WorkspaceId,
    id: ModelProviderConnectionId,
  ): Promise<ModelProviderConnection | null>;
  listConnectionsByWorkspaceId(
    workspaceId: WorkspaceId,
  ): Promise<ModelProviderConnection[]>;
  updateConnectionMetadata(
    id: ModelProviderConnectionId,
    metadata: ModelProviderConnectionMetadataUpdate,
  ): Promise<ModelProviderConnection | null>;
  saveConnectionVersion(version: ModelProviderConnectionVersion): Promise<void>;
  appendConnectionVersion(
    input: AppendModelProviderConnectionVersionInput,
  ): Promise<ModelProviderConnectionVersion>;
  findConnectionVersionById(
    id: ModelProviderConnectionVersionId,
  ): Promise<ModelProviderConnectionVersion | null>;
  findConnectionVersionByConnectionAndId(
    connectionId: ModelProviderConnectionId,
    connectionVersionId: ModelProviderConnectionVersionId,
  ): Promise<ModelProviderConnectionVersion | null>;
  listConnectionVersions(
    connectionId: ModelProviderConnectionId,
  ): Promise<ModelProviderConnectionVersion[]>;
}
