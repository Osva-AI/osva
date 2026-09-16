import type { ToolId, ToolVersionId } from "@osva/contracts";
import {
  DomainInvariantError,
  DuplicateToolKeyError,
  ToolNotFoundError,
  ToolVersion,
  type AppendToolVersionInput,
  type Tool,
  type ToolMetadataUpdate,
  type ToolRepository,
} from "@osva/domain";
import { asc, eq, max } from "drizzle-orm";

import type { Database } from "../database.js";
import { toolFromRow, toolToRow } from "../mappers/tool-mapper.js";
import {
  isSameToolVersion,
  toolVersionFromRow,
  toolVersionToRow,
} from "../mappers/tool-version-mapper.js";
import {
  POSTGRES_UNIQUE_VIOLATION,
  mapDatabaseError,
  postgresConstraintName,
  postgresErrorCode,
} from "../postgres-errors.js";
import { toolVersions } from "../schema/tool-versions.js";
import { tools } from "../schema/tools.js";

export class PostgresToolRepository implements ToolRepository {
  constructor(private readonly database: Database) {}

  async saveTool(tool: Tool): Promise<void> {
    const row = toolToRow(tool);

    try {
      await this.database.db
        .insert(tools)
        .values(row)
        .onConflictDoUpdate({
          target: tools.id,
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
        postgresConstraintName(error) === "tools_workspace_id_key_unique"
      ) {
        throw new DuplicateToolKeyError(tool.workspaceId, tool.key);
      }

      throw mapDatabaseError(error, {
        tools_workspace_id_key_unique: `Tool key '${tool.key}' already exists in workspace '${tool.workspaceId}'.`,
      });
    }
  }

  async findToolById(id: ToolId): Promise<Tool | null> {
    const [row] = await this.database.db
      .select()
      .from(tools)
      .where(eq(tools.id, id))
      .limit(1);

    return row === undefined ? null : toolFromRow(row);
  }

  async listTools(): Promise<Tool[]> {
    const rows = await this.database.db
      .select()
      .from(tools)
      .orderBy(asc(tools.createdAt), asc(tools.id));

    return rows.map(toolFromRow);
  }

  async updateToolMetadata(
    id: ToolId,
    metadata: ToolMetadataUpdate,
  ): Promise<Tool | null> {
    const existing = await this.findToolById(id);
    if (existing === null) {
      return null;
    }

    const updated = existing.withName(metadata.name);

    await this.database.db
      .update(tools)
      .set({ name: updated.name })
      .where(eq(tools.id, id));

    return updated;
  }

  async saveToolVersion(version: ToolVersion): Promise<void> {
    const existing = await this.findToolVersionById(version.id);

    if (existing) {
      if (isSameToolVersion(existing, version)) {
        return;
      }

      throw new DomainInvariantError(
        `ToolVersion '${version.id}' is immutable and cannot be replaced with different content.`,
      );
    }

    try {
      await this.database.db
        .insert(toolVersions)
        .values(toolVersionToRow(version));
    } catch (error) {
      if (postgresErrorCode(error) === POSTGRES_UNIQUE_VIOLATION) {
        const constraint = postgresConstraintName(error);

        if (
          constraint === "tool_versions_id_pk" ||
          constraint === "tool_versions_pkey"
        ) {
          const stored = await this.findToolVersionById(version.id);
          if (stored && isSameToolVersion(stored, version)) {
            return;
          }

          throw new DomainInvariantError(
            `ToolVersion '${version.id}' is immutable and cannot be replaced with different content.`,
          );
        }

        if (constraint === "tool_versions_tool_id_version_unique") {
          throw new DomainInvariantError(
            `ToolVersion already exists for tool '${version.toolId}' version ${String(version.version)}.`,
          );
        }
      }

      throw mapDatabaseError(error, {
        tool_versions_tool_id_version_unique: `ToolVersion already exists for tool '${version.toolId}' version ${String(version.version)}.`,
      });
    }
  }

  async appendToolVersion(input: AppendToolVersionInput): Promise<ToolVersion> {
    return this.database.db.transaction(async (tx) => {
      const [toolRow] = await tx
        .select()
        .from(tools)
        .where(eq(tools.id, input.toolId))
        .for("update")
        .limit(1);

      if (toolRow === undefined) {
        throw new ToolNotFoundError(input.toolId);
      }

      const [aggregate] = await tx
        .select({ maxVersion: max(toolVersions.version) })
        .from(toolVersions)
        .where(eq(toolVersions.toolId, input.toolId));

      const nextVersion = (aggregate?.maxVersion ?? 0) + 1;
      const version = ToolVersion.create({
        id: input.id,
        toolId: input.toolId,
        version: nextVersion,
        type: input.type,
        implementation: input.implementation,
        mcp: input.mcp,
        createdAt: input.createdAt,
      });

      try {
        await tx.insert(toolVersions).values(toolVersionToRow(version));
      } catch (error) {
        throw mapDatabaseError(error, {
          tool_versions_tool_id_version_unique: `ToolVersion already exists for tool '${input.toolId}' version ${String(nextVersion)}.`,
        });
      }

      return version;
    });
  }

  async findToolVersionById(id: ToolVersionId): Promise<ToolVersion | null> {
    const [row] = await this.database.db
      .select()
      .from(toolVersions)
      .where(eq(toolVersions.id, id))
      .limit(1);

    return row === undefined ? null : toolVersionFromRow(row);
  }

  async listToolVersions(toolId: ToolId): Promise<ToolVersion[]> {
    const rows = await this.database.db
      .select()
      .from(toolVersions)
      .where(eq(toolVersions.toolId, toolId))
      .orderBy(asc(toolVersions.version));

    return rows.map(toolVersionFromRow);
  }
}
