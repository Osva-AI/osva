import type { AgentId, AgentVersionId } from "@osva/contracts";
import {
  AgentNotFoundError,
  AgentVersion,
  DomainInvariantError,
  DuplicateAgentKeyError,
  type Agent,
  type AgentMetadataUpdate,
  type AgentRepository,
  type AppendAgentVersionInput,
} from "@osva/domain";
import { asc, eq, max } from "drizzle-orm";

import type { Database } from "../database.js";
import { agentFromRow, agentToRow } from "../mappers/agent-mapper.js";
import {
  agentVersionFromRow,
  agentVersionToRow,
  isSameAgentVersion,
} from "../mappers/agent-version-mapper.js";
import {
  POSTGRES_UNIQUE_VIOLATION,
  mapDatabaseError,
  postgresConstraintName,
  postgresErrorCode,
} from "../postgres-errors.js";
import { agentVersions } from "../schema/agent-versions.js";
import { agents } from "../schema/agents.js";

export class PostgresAgentRepository implements AgentRepository {
  constructor(private readonly database: Database) {}

  async saveAgent(agent: Agent): Promise<void> {
    const row = agentToRow(agent);

    try {
      await this.database.db
        .insert(agents)
        .values(row)
        .onConflictDoUpdate({
          target: agents.id,
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
        postgresConstraintName(error) === "agents_workspace_id_key_unique"
      ) {
        throw new DuplicateAgentKeyError(agent.workspaceId, agent.key);
      }

      throw mapDatabaseError(error, {
        agents_workspace_id_key_unique: `Agent key '${agent.key}' already exists in workspace '${agent.workspaceId}'.`,
      });
    }
  }

  async findAgentById(id: AgentId): Promise<Agent | null> {
    const [row] = await this.database.db
      .select()
      .from(agents)
      .where(eq(agents.id, id))
      .limit(1);

    return row === undefined ? null : agentFromRow(row);
  }

  async listAgents(): Promise<Agent[]> {
    const rows = await this.database.db
      .select()
      .from(agents)
      .orderBy(asc(agents.createdAt), asc(agents.id));

    return rows.map(agentFromRow);
  }

  async updateAgentMetadata(
    id: AgentId,
    metadata: AgentMetadataUpdate,
  ): Promise<Agent | null> {
    const existing = await this.findAgentById(id);
    if (existing === null) {
      return null;
    }

    const updated = existing.withName(metadata.name);

    await this.database.db
      .update(agents)
      .set({ name: updated.name })
      .where(eq(agents.id, id));

    return updated;
  }

  async saveAgentVersion(agentVersion: AgentVersion): Promise<void> {
    const existing = await this.findAgentVersionById(agentVersion.id);

    if (existing) {
      if (isSameAgentVersion(existing, agentVersion)) {
        return;
      }

      throw new DomainInvariantError(
        `AgentVersion '${agentVersion.id}' is immutable and cannot be replaced with different content.`,
      );
    }

    try {
      await this.database.db
        .insert(agentVersions)
        .values(agentVersionToRow(agentVersion));
    } catch (error) {
      if (postgresErrorCode(error) === POSTGRES_UNIQUE_VIOLATION) {
        const constraint = postgresConstraintName(error);

        if (
          constraint === "agent_versions_id_pk" ||
          constraint === "agent_versions_pkey"
        ) {
          const stored = await this.findAgentVersionById(agentVersion.id);
          if (stored && isSameAgentVersion(stored, agentVersion)) {
            return;
          }

          throw new DomainInvariantError(
            `AgentVersion '${agentVersion.id}' is immutable and cannot be replaced with different content.`,
          );
        }

        if (constraint === "agent_versions_agent_id_version_unique") {
          throw new DomainInvariantError(
            `AgentVersion already exists for agent '${agentVersion.agentId}' version ${String(agentVersion.version)}.`,
          );
        }
      }

      throw mapDatabaseError(error, {
        agent_versions_agent_id_version_unique: `AgentVersion already exists for agent '${agentVersion.agentId}' version ${String(agentVersion.version)}.`,
      });
    }
  }

  async appendAgentVersion(
    input: AppendAgentVersionInput,
  ): Promise<AgentVersion> {
    return this.database.db.transaction(async (tx) => {
      const [agentRow] = await tx
        .select()
        .from(agents)
        .where(eq(agents.id, input.agentId))
        .for("update")
        .limit(1);

      if (agentRow === undefined) {
        throw new AgentNotFoundError(input.agentId);
      }

      const [aggregate] = await tx
        .select({ maxVersion: max(agentVersions.version) })
        .from(agentVersions)
        .where(eq(agentVersions.agentId, input.agentId));

      const nextVersion = (aggregate?.maxVersion ?? 0) + 1;
      const agentVersion = AgentVersion.create({
        id: input.id,
        agentId: input.agentId,
        version: nextVersion,
        manifest: input.manifest,
        createdAt: input.createdAt,
      });

      try {
        await tx.insert(agentVersions).values(agentVersionToRow(agentVersion));
      } catch (error) {
        throw mapDatabaseError(error, {
          agent_versions_agent_id_version_unique: `AgentVersion already exists for agent '${input.agentId}' version ${String(nextVersion)}.`,
        });
      }

      return agentVersion;
    });
  }

  async findAgentVersionById(id: AgentVersionId): Promise<AgentVersion | null> {
    const [row] = await this.database.db
      .select()
      .from(agentVersions)
      .where(eq(agentVersions.id, id))
      .limit(1);

    return row === undefined ? null : agentVersionFromRow(row);
  }

  async listAgentVersions(agentId: AgentId): Promise<AgentVersion[]> {
    const rows = await this.database.db
      .select()
      .from(agentVersions)
      .where(eq(agentVersions.agentId, agentId))
      .orderBy(asc(agentVersions.version));

    return rows.map(agentVersionFromRow);
  }
}
