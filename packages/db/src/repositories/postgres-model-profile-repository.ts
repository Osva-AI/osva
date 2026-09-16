import type { ModelProfileId, ModelProfileVersionId } from "@osva/contracts";
import {
  DomainInvariantError,
  DuplicateModelProfileKeyError,
  ModelProfileNotFoundError,
  ModelProfileVersion,
  type AppendModelProfileVersionInput,
  type ModelProfile,
  type ModelProfileMetadataUpdate,
  type ModelProfileRepository,
} from "@osva/domain";
import { asc, eq, max } from "drizzle-orm";

import type { Database } from "../database.js";
import {
  modelProfileFromRow,
  modelProfileToRow,
} from "../mappers/model-profile-mapper.js";
import {
  isSameModelProfileVersion,
  modelProfileVersionFromRow,
  modelProfileVersionToRow,
} from "../mappers/model-profile-version-mapper.js";
import {
  POSTGRES_UNIQUE_VIOLATION,
  mapDatabaseError,
  postgresConstraintName,
  postgresErrorCode,
} from "../postgres-errors.js";
import { modelProfileVersions } from "../schema/model-profile-versions.js";
import { modelProfiles } from "../schema/model-profiles.js";

export class PostgresModelProfileRepository implements ModelProfileRepository {
  constructor(private readonly database: Database) {}

  async saveModelProfile(profile: ModelProfile): Promise<void> {
    const row = modelProfileToRow(profile);

    try {
      await this.database.db
        .insert(modelProfiles)
        .values(row)
        .onConflictDoUpdate({
          target: modelProfiles.id,
          set: {
            workspaceId: row.workspaceId,
            key: row.key,
            name: row.name,
            createdAt: row.createdAt,
          },
        });
    } catch (error) {
      if (
        postgresErrorCode(error) === POSTGRES_UNIQUE_VIOLATION &&
        postgresConstraintName(error) ===
          "model_profiles_workspace_id_key_unique"
      ) {
        throw new DuplicateModelProfileKeyError(
          profile.workspaceId,
          profile.key,
        );
      }

      throw mapDatabaseError(error, {
        model_profiles_workspace_id_key_unique: `ModelProfile key '${profile.key}' already exists in workspace '${profile.workspaceId}'.`,
      });
    }
  }

  async findModelProfileById(id: ModelProfileId): Promise<ModelProfile | null> {
    const [row] = await this.database.db
      .select()
      .from(modelProfiles)
      .where(eq(modelProfiles.id, id))
      .limit(1);

    return row === undefined ? null : modelProfileFromRow(row);
  }

  async listModelProfiles(): Promise<ModelProfile[]> {
    const rows = await this.database.db
      .select()
      .from(modelProfiles)
      .orderBy(asc(modelProfiles.createdAt), asc(modelProfiles.id));

    return rows.map(modelProfileFromRow);
  }

  async updateModelProfileMetadata(
    id: ModelProfileId,
    metadata: ModelProfileMetadataUpdate,
  ): Promise<ModelProfile | null> {
    const existing = await this.findModelProfileById(id);
    if (existing === null) {
      return null;
    }

    const updated = existing.withName(metadata.name);

    await this.database.db
      .update(modelProfiles)
      .set({ name: updated.name })
      .where(eq(modelProfiles.id, id));

    return updated;
  }

  async saveModelProfileVersion(version: ModelProfileVersion): Promise<void> {
    const existing = await this.findModelProfileVersionById(version.id);

    if (existing) {
      if (isSameModelProfileVersion(existing, version)) {
        return;
      }

      throw new DomainInvariantError(
        `ModelProfileVersion '${version.id}' is immutable and cannot be replaced with different content.`,
      );
    }

    try {
      await this.database.db
        .insert(modelProfileVersions)
        .values(modelProfileVersionToRow(version));
    } catch (error) {
      if (postgresErrorCode(error) === POSTGRES_UNIQUE_VIOLATION) {
        const constraint = postgresConstraintName(error);

        if (
          constraint === "model_profile_versions_id_pk" ||
          constraint === "model_profile_versions_pkey"
        ) {
          const stored = await this.findModelProfileVersionById(version.id);
          if (stored && isSameModelProfileVersion(stored, version)) {
            return;
          }

          throw new DomainInvariantError(
            `ModelProfileVersion '${version.id}' is immutable and cannot be replaced with different content.`,
          );
        }

        if (
          constraint ===
          "model_profile_versions_model_profile_id_version_unique"
        ) {
          throw new DomainInvariantError(
            `ModelProfileVersion already exists for profile '${version.modelProfileId}' version ${String(version.version)}.`,
          );
        }
      }

      throw mapDatabaseError(error, {
        model_profile_versions_model_profile_id_version_unique: `ModelProfileVersion already exists for profile '${version.modelProfileId}' version ${String(version.version)}.`,
      });
    }
  }

  async appendModelProfileVersion(
    input: AppendModelProfileVersionInput,
  ): Promise<ModelProfileVersion> {
    return this.database.db.transaction(async (tx) => {
      const [profileRow] = await tx
        .select()
        .from(modelProfiles)
        .where(eq(modelProfiles.id, input.modelProfileId))
        .for("update")
        .limit(1);

      if (profileRow === undefined) {
        throw new ModelProfileNotFoundError(input.modelProfileId);
      }

      const [aggregate] = await tx
        .select({ maxVersion: max(modelProfileVersions.version) })
        .from(modelProfileVersions)
        .where(eq(modelProfileVersions.modelProfileId, input.modelProfileId));

      const nextVersion = (aggregate?.maxVersion ?? 0) + 1;
      const version = ModelProfileVersion.create({
        id: input.id,
        modelProfileId: input.modelProfileId,
        version: nextVersion,
        provider: input.provider,
        model: input.model,
        pricing: input.pricing,
        createdAt: input.createdAt,
      });

      try {
        await tx
          .insert(modelProfileVersions)
          .values(modelProfileVersionToRow(version));
      } catch (error) {
        throw mapDatabaseError(error, {
          model_profile_versions_model_profile_id_version_unique: `ModelProfileVersion already exists for profile '${input.modelProfileId}' version ${String(nextVersion)}.`,
        });
      }

      return version;
    });
  }

  async findModelProfileVersionById(
    id: ModelProfileVersionId,
  ): Promise<ModelProfileVersion | null> {
    const [row] = await this.database.db
      .select()
      .from(modelProfileVersions)
      .where(eq(modelProfileVersions.id, id))
      .limit(1);

    return row === undefined ? null : modelProfileVersionFromRow(row);
  }

  async listModelProfileVersions(
    modelProfileId: ModelProfileId,
  ): Promise<ModelProfileVersion[]> {
    const rows = await this.database.db
      .select()
      .from(modelProfileVersions)
      .where(eq(modelProfileVersions.modelProfileId, modelProfileId))
      .orderBy(asc(modelProfileVersions.version));

    return rows.map(modelProfileVersionFromRow);
  }
}
