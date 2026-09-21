import type {
  ModelProfileId,
  ModelProfileVersionId,
  ModelProfileVersionPricing,
  ModelProvider,
  WorkspaceId,
} from "@osva/contracts";

import type { ModelProfile } from "../model-profile.js";
import type { ModelProfileVersion } from "../model-profile-version.js";

export interface ModelProfileMetadataUpdate {
  readonly name: string;
}

export interface AppendModelProfileVersionInput {
  readonly id: ModelProfileVersionId;
  readonly modelProfileId: ModelProfileId;
  readonly provider: ModelProvider;
  readonly model: string;
  readonly pricing?: ModelProfileVersionPricing;
  readonly createdAt: Date;
}

export interface ModelProfileRepository {
  saveModelProfile(profile: ModelProfile): Promise<void>;
  findModelProfileById(id: ModelProfileId): Promise<ModelProfile | null>;
  findModelProfileByWorkspaceAndId(
    workspaceId: WorkspaceId,
    id: ModelProfileId,
  ): Promise<ModelProfile | null>;
  listModelProfiles(): Promise<ModelProfile[]>;
  listModelProfilesByWorkspaceId(
    workspaceId: WorkspaceId,
  ): Promise<ModelProfile[]>;
  updateModelProfileMetadata(
    id: ModelProfileId,
    metadata: ModelProfileMetadataUpdate,
  ): Promise<ModelProfile | null>;
  saveModelProfileVersion(version: ModelProfileVersion): Promise<void>;
  appendModelProfileVersion(
    input: AppendModelProfileVersionInput,
  ): Promise<ModelProfileVersion>;
  findModelProfileVersionById(
    id: ModelProfileVersionId,
  ): Promise<ModelProfileVersion | null>;
  listModelProfileVersions(
    modelProfileId: ModelProfileId,
  ): Promise<ModelProfileVersion[]>;
}
