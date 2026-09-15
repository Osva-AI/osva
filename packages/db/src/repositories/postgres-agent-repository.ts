import type { AgentId, AgentVersionId } from "@osva/contracts";
import {
  DomainInvariantError,
  type Agent,
  type AgentRepository,
  type AgentVersion,
} from "@osva/domain";
import { eq } from "drizzle-orm";

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
  withMappedDatabaseErrors,
} from "../postgres-errors.js";
import { agentVersions } from "../schema/agent-versions.js";
import { agents } from "../schema/agents.js";

export class PostgresAgentRepository implements AgentRepository {
  constructor(private readonly database: Database) {}

  async saveAgent(agent: Agent): Promise<void> {
    const row = agentToRow(agent);

    await withMappedDatabaseErrors(
      () =>
        this.database.db
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
          }),
      {
        agents_workspace_id_key_unique: `Agent key '${agent.key}' already exists in workspace '${agent.workspaceId}'.`,
      },
    );
  }

  async findAgentById(id: AgentId): Promise<Agent | null> {
    const [row] = await this.database.db
      .select()
      .from(agents)
      .where(eq(agents.id, id))
      .limit(1);

    return row === undefined ? null : agentFromRow(row);
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

  async findAgentVersionById(id: AgentVersionId): Promise<AgentVersion | null> {
    const [row] = await this.database.db
      .select()
      .from(agentVersions)
      .where(eq(agentVersions.id, id))
      .limit(1);

    return row === undefined ? null : agentVersionFromRow(row);
  }
}
