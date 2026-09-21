import type {
  ModelProfileId,
  ModelProfileVersionId,
  ModelProfileVersionPricing,
  ModelProvider,
  WorkspaceId,
} from "@osva/contracts";
import { AUTHORIZATION_ACTIONS } from "@osva/contracts";

import {
  ModelProfileNotFoundError,
  ModelProfileVersionNotFoundError,
  WorkspaceNotFoundError,
} from "./errors.js";
import { ModelProfile } from "./model-profile.js";
import type { ModelProfileVersion } from "./model-profile-version.js";
import type { ModelProfileRepository } from "./ports/model-profile-repository.js";
import type { WorkspaceRepository } from "./ports/workspace-repository.js";
import {
  controlPlaneWorkspaceId,
  requireControlPlaneAuthorization,
  type ControlPlaneScope,
} from "./control-plane.js";
import { CONTROL_PLANE_RESOURCE_KINDS } from "./control-plane-resource-kinds.js";

const MODEL_PROFILE_RESOURCE = {
  kind: CONTROL_PLANE_RESOURCE_KINDS.modelProfile,
};

export interface ModelProfileApplicationClock {
  now(): Date;
}

export interface ModelProfileApplicationIds {
  createId(): string;
}

export interface ModelProfileApplicationDependencies {
  readonly modelProfiles: ModelProfileRepository;
  readonly workspaces: WorkspaceRepository;
  readonly clock: ModelProfileApplicationClock;
  readonly ids: ModelProfileApplicationIds;
}

export interface CreateModelProfileCommand {
  readonly workspaceId: WorkspaceId;
  readonly key: string;
  readonly name: string;
}

export interface UpdateModelProfileMetadataCommand {
  readonly modelProfileId: ModelProfileId;
  readonly name: string;
}

export interface AppendModelProfileVersionCommand {
  readonly modelProfileId: ModelProfileId;
  readonly provider: ModelProvider;
  readonly model: string;
  readonly pricing?: ModelProfileVersionPricing;
}

export interface GetModelProfileVersionCommand {
  readonly modelProfileId: ModelProfileId;
  readonly modelProfileVersionId: ModelProfileVersionId;
}

export class CreateModelProfile {
  constructor(private readonly deps: ModelProfileApplicationDependencies) {}

  async execute(
    scope: ControlPlaneScope,
    command: CreateModelProfileCommand,
  ): Promise<ModelProfile> {
    requireControlPlaneAuthorization(
      scope,
      AUTHORIZATION_ACTIONS.WRITE,
      MODEL_PROFILE_RESOURCE,
    );
    const workspaceId = controlPlaneWorkspaceId(scope);
    const workspace = await this.deps.workspaces.findById(workspaceId);
    if (workspace === null) {
      throw new WorkspaceNotFoundError(workspaceId);
    }

    const profile = ModelProfile.create({
      id: this.deps.ids.createId() as ModelProfileId,
      workspaceId,
      key: command.key,
      name: command.name,
      createdAt: this.deps.clock.now(),
    });

    await this.deps.modelProfiles.saveModelProfile(profile);
    return profile;
  }
}

export class GetModelProfile {
  constructor(private readonly deps: ModelProfileApplicationDependencies) {}

  async execute(
    scope: ControlPlaneScope,
    modelProfileId: ModelProfileId,
  ): Promise<ModelProfile> {
    requireControlPlaneAuthorization(
      scope,
      AUTHORIZATION_ACTIONS.READ,
      MODEL_PROFILE_RESOURCE,
    );
    const profile =
      await this.deps.modelProfiles.findModelProfileByWorkspaceAndId(
        controlPlaneWorkspaceId(scope),
        modelProfileId,
      );
    if (profile === null) {
      throw new ModelProfileNotFoundError(modelProfileId);
    }

    return profile;
  }
}

export class ListModelProfiles {
  constructor(private readonly deps: ModelProfileApplicationDependencies) {}

  async execute(scope: ControlPlaneScope): Promise<ModelProfile[]> {
    requireControlPlaneAuthorization(
      scope,
      AUTHORIZATION_ACTIONS.READ,
      MODEL_PROFILE_RESOURCE,
    );
    return this.deps.modelProfiles.listModelProfilesByWorkspaceId(
      controlPlaneWorkspaceId(scope),
    );
  }
}

export class UpdateModelProfileMetadata {
  constructor(private readonly deps: ModelProfileApplicationDependencies) {}

  async execute(
    scope: ControlPlaneScope,
    command: UpdateModelProfileMetadataCommand,
  ): Promise<ModelProfile> {
    requireControlPlaneAuthorization(
      scope,
      AUTHORIZATION_ACTIONS.WRITE,
      MODEL_PROFILE_RESOURCE,
    );
    const existing =
      await this.deps.modelProfiles.findModelProfileByWorkspaceAndId(
        controlPlaneWorkspaceId(scope),
        command.modelProfileId,
      );
    if (existing === null) {
      throw new ModelProfileNotFoundError(command.modelProfileId);
    }

    const updated = await this.deps.modelProfiles.updateModelProfileMetadata(
      command.modelProfileId,
      { name: command.name },
    );
    if (updated === null) {
      throw new ModelProfileNotFoundError(command.modelProfileId);
    }

    return updated;
  }
}

export class AppendModelProfileVersion {
  constructor(private readonly deps: ModelProfileApplicationDependencies) {}

  async execute(
    scope: ControlPlaneScope,
    command: AppendModelProfileVersionCommand,
  ): Promise<ModelProfileVersion> {
    requireControlPlaneAuthorization(
      scope,
      AUTHORIZATION_ACTIONS.WRITE,
      MODEL_PROFILE_RESOURCE,
    );
    const profile =
      await this.deps.modelProfiles.findModelProfileByWorkspaceAndId(
        controlPlaneWorkspaceId(scope),
        command.modelProfileId,
      );
    if (profile === null) {
      throw new ModelProfileNotFoundError(command.modelProfileId);
    }

    return this.deps.modelProfiles.appendModelProfileVersion({
      id: this.deps.ids.createId() as ModelProfileVersionId,
      modelProfileId: command.modelProfileId,
      provider: command.provider,
      model: command.model,
      pricing: command.pricing,
      createdAt: this.deps.clock.now(),
    });
  }
}

export class GetModelProfileVersion {
  constructor(private readonly deps: ModelProfileApplicationDependencies) {}

  async execute(
    scope: ControlPlaneScope,
    command: GetModelProfileVersionCommand,
  ): Promise<ModelProfileVersion> {
    requireControlPlaneAuthorization(
      scope,
      AUTHORIZATION_ACTIONS.READ,
      MODEL_PROFILE_RESOURCE,
    );
    const profile =
      await this.deps.modelProfiles.findModelProfileByWorkspaceAndId(
        controlPlaneWorkspaceId(scope),
        command.modelProfileId,
      );
    if (profile === null) {
      throw new ModelProfileNotFoundError(command.modelProfileId);
    }

    const version = await this.deps.modelProfiles.findModelProfileVersionById(
      command.modelProfileVersionId,
    );
    if (version === null || version.modelProfileId !== command.modelProfileId) {
      throw new ModelProfileVersionNotFoundError(command.modelProfileVersionId);
    }

    return version;
  }
}

export class ListModelProfileVersions {
  constructor(private readonly deps: ModelProfileApplicationDependencies) {}

  async execute(
    scope: ControlPlaneScope,
    modelProfileId: ModelProfileId,
  ): Promise<ModelProfileVersion[]> {
    requireControlPlaneAuthorization(
      scope,
      AUTHORIZATION_ACTIONS.READ,
      MODEL_PROFILE_RESOURCE,
    );
    const profile =
      await this.deps.modelProfiles.findModelProfileByWorkspaceAndId(
        controlPlaneWorkspaceId(scope),
        modelProfileId,
      );
    if (profile === null) {
      throw new ModelProfileNotFoundError(modelProfileId);
    }

    return this.deps.modelProfiles.listModelProfileVersions(modelProfileId);
  }
}

export interface ModelProfileApplication {
  readonly createModelProfile: CreateModelProfile;
  readonly getModelProfile: GetModelProfile;
  readonly listModelProfiles: ListModelProfiles;
  readonly updateModelProfileMetadata: UpdateModelProfileMetadata;
  readonly appendModelProfileVersion: AppendModelProfileVersion;
  readonly getModelProfileVersion: GetModelProfileVersion;
  readonly listModelProfileVersions: ListModelProfileVersions;
}

export function createModelProfileApplication(
  deps: ModelProfileApplicationDependencies,
): ModelProfileApplication {
  return {
    createModelProfile: new CreateModelProfile(deps),
    getModelProfile: new GetModelProfile(deps),
    listModelProfiles: new ListModelProfiles(deps),
    updateModelProfileMetadata: new UpdateModelProfileMetadata(deps),
    appendModelProfileVersion: new AppendModelProfileVersion(deps),
    getModelProfileVersion: new GetModelProfileVersion(deps),
    listModelProfileVersions: new ListModelProfileVersions(deps),
  };
}
