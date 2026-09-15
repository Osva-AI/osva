import type {
  ModelProfileId,
  ModelProfileVersionId,
  ModelProfileVersionPricing,
  ModelProvider,
  WorkspaceId,
} from "@osva/contracts";

import {
  ModelProfileNotFoundError,
  ModelProfileVersionNotFoundError,
  WorkspaceNotFoundError,
} from "./errors.js";
import { ModelProfile } from "./model-profile.js";
import type { ModelProfileVersion } from "./model-profile-version.js";
import type { ModelProfileRepository } from "./ports/model-profile-repository.js";
import type { WorkspaceRepository } from "./ports/workspace-repository.js";

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

  async execute(command: CreateModelProfileCommand): Promise<ModelProfile> {
    const workspace = await this.deps.workspaces.findById(command.workspaceId);
    if (workspace === null) {
      throw new WorkspaceNotFoundError(command.workspaceId);
    }

    const profile = ModelProfile.create({
      id: this.deps.ids.createId() as ModelProfileId,
      workspaceId: command.workspaceId,
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

  async execute(modelProfileId: ModelProfileId): Promise<ModelProfile> {
    const profile =
      await this.deps.modelProfiles.findModelProfileById(modelProfileId);
    if (profile === null) {
      throw new ModelProfileNotFoundError(modelProfileId);
    }

    return profile;
  }
}

export class ListModelProfiles {
  constructor(private readonly deps: ModelProfileApplicationDependencies) {}

  async execute(): Promise<ModelProfile[]> {
    return this.deps.modelProfiles.listModelProfiles();
  }
}

export class UpdateModelProfileMetadata {
  constructor(private readonly deps: ModelProfileApplicationDependencies) {}

  async execute(
    command: UpdateModelProfileMetadataCommand,
  ): Promise<ModelProfile> {
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
    command: AppendModelProfileVersionCommand,
  ): Promise<ModelProfileVersion> {
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
    command: GetModelProfileVersionCommand,
  ): Promise<ModelProfileVersion> {
    const profile = await this.deps.modelProfiles.findModelProfileById(
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
    modelProfileId: ModelProfileId,
  ): Promise<ModelProfileVersion[]> {
    const profile =
      await this.deps.modelProfiles.findModelProfileById(modelProfileId);
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
