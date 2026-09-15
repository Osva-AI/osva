import type { ModelProfileId, ModelProfileVersionId } from "@osva/contracts";
import {
  DomainInvariantError,
  DuplicateModelProfileKeyError,
  ModelProfile,
  ModelProfileNotFoundError,
  ModelProfileVersion,
  type ModelProfileMetadataUpdate,
  type ModelProfileRepository,
  type AppendModelProfileVersionInput,
} from "@osva/domain";

export class MemoryModelProfileRepository implements ModelProfileRepository {
  private readonly profiles = new Map<ModelProfileId, ModelProfile>();
  private readonly versions = new Map<
    ModelProfileVersionId,
    ModelProfileVersion
  >();

  async saveModelProfile(profile: ModelProfile): Promise<void> {
    for (const existing of this.profiles.values()) {
      if (
        existing.id !== profile.id &&
        existing.workspaceId === profile.workspaceId &&
        existing.key === profile.key
      ) {
        throw new DuplicateModelProfileKeyError(
          profile.workspaceId,
          profile.key,
        );
      }
    }

    this.profiles.set(profile.id, profile);
  }

  async findModelProfileById(id: ModelProfileId): Promise<ModelProfile | null> {
    return this.profiles.get(id) ?? null;
  }

  async listModelProfiles(): Promise<ModelProfile[]> {
    return [...this.profiles.values()].sort(compareModelProfiles);
  }

  async updateModelProfileMetadata(
    id: ModelProfileId,
    metadata: ModelProfileMetadataUpdate,
  ): Promise<ModelProfile | null> {
    const existing = this.profiles.get(id);
    if (existing === undefined) {
      return null;
    }

    const updated = existing.withName(metadata.name);
    this.profiles.set(id, updated);
    return updated;
  }

  async saveModelProfileVersion(version: ModelProfileVersion): Promise<void> {
    const existing = this.versions.get(version.id);

    if (existing && !isSameModelProfileVersion(existing, version)) {
      throw new DomainInvariantError(
        `ModelProfileVersion '${version.id}' is immutable and cannot be replaced with different content.`,
      );
    }

    if (!existing) {
      for (const stored of this.versions.values()) {
        if (
          stored.modelProfileId === version.modelProfileId &&
          stored.version === version.version
        ) {
          throw new DomainInvariantError(
            `ModelProfileVersion already exists for profile '${version.modelProfileId}' version ${String(version.version)}.`,
          );
        }
      }
    }

    this.versions.set(version.id, existing ?? version);
  }

  async appendModelProfileVersion(
    input: AppendModelProfileVersionInput,
  ): Promise<ModelProfileVersion> {
    if (!this.profiles.has(input.modelProfileId)) {
      throw new ModelProfileNotFoundError(input.modelProfileId);
    }

    let maxVersion = 0;
    for (const stored of this.versions.values()) {
      if (
        stored.modelProfileId === input.modelProfileId &&
        stored.version > maxVersion
      ) {
        maxVersion = stored.version;
      }
    }

    const version = ModelProfileVersion.create({
      id: input.id,
      modelProfileId: input.modelProfileId,
      version: maxVersion + 1,
      provider: input.provider,
      model: input.model,
      createdAt: input.createdAt,
    });

    await this.saveModelProfileVersion(version);
    return version;
  }

  async findModelProfileVersionById(
    id: ModelProfileVersionId,
  ): Promise<ModelProfileVersion | null> {
    return this.versions.get(id) ?? null;
  }

  async listModelProfileVersions(
    modelProfileId: ModelProfileId,
  ): Promise<ModelProfileVersion[]> {
    return [...this.versions.values()]
      .filter((version) => version.modelProfileId === modelProfileId)
      .sort(compareModelProfileVersions);
  }
}

function compareModelProfiles(left: ModelProfile, right: ModelProfile): number {
  const created = left.createdAt.getTime() - right.createdAt.getTime();
  if (created !== 0) {
    return created;
  }

  if (left.id < right.id) {
    return -1;
  }

  if (left.id > right.id) {
    return 1;
  }

  return 0;
}

function compareModelProfileVersions(
  left: ModelProfileVersion,
  right: ModelProfileVersion,
): number {
  return left.version - right.version;
}

function isSameModelProfileVersion(
  left: ModelProfileVersion,
  right: ModelProfileVersion,
): boolean {
  return (
    left.id === right.id &&
    left.modelProfileId === right.modelProfileId &&
    left.version === right.version &&
    left.provider === right.provider &&
    left.model === right.model &&
    left.createdAt.getTime() === right.createdAt.getTime()
  );
}
