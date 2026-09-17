import type {
  WorkflowId,
  WorkflowVersionId,
  WorkspaceId,
} from "@osva/contracts";
import {
  DomainInvariantError,
  DuplicateWorkflowKeyError,
  WorkflowNotFoundError,
  WorkflowVersion,
  type AppendWorkflowVersionInput,
  type Workflow,
  type WorkflowRepository,
} from "@osva/domain";
import { asc, eq, max } from "drizzle-orm";

import type { Database } from "../database.js";
import { workflowFromRow, workflowToRow } from "../mappers/workflow-mapper.js";
import {
  isSameWorkflowVersion,
  workflowVersionFromRow,
  workflowVersionToRow,
} from "../mappers/workflow-version-mapper.js";
import {
  POSTGRES_UNIQUE_VIOLATION,
  mapDatabaseError,
  postgresConstraintName,
  postgresErrorCode,
} from "../postgres-errors.js";
import { workflowVersions } from "../schema/workflow-versions.js";
import { workflows } from "../schema/workflows.js";

export class PostgresWorkflowRepository implements WorkflowRepository {
  constructor(private readonly database: Database) {}

  async saveWorkflow(workflow: Workflow): Promise<void> {
    const row = workflowToRow(workflow);

    try {
      await this.database.db
        .insert(workflows)
        .values(row)
        .onConflictDoUpdate({
          target: workflows.id,
          set: {
            workspaceId: row.workspaceId,
            key: row.key,
            name: row.name,
            description: row.description,
            createdAt: row.createdAt,
            updatedAt: row.updatedAt,
          },
        });
    } catch (error) {
      if (
        postgresErrorCode(error) === POSTGRES_UNIQUE_VIOLATION &&
        postgresConstraintName(error) === "workflows_workspace_id_key_unique"
      ) {
        throw new DuplicateWorkflowKeyError(workflow.workspaceId, workflow.key);
      }

      throw mapDatabaseError(error, {
        workflows_workspace_id_key_unique: `Workflow key '${workflow.key}' already exists in workspace '${workflow.workspaceId}'.`,
      });
    }
  }

  async findWorkflowById(id: WorkflowId): Promise<Workflow | null> {
    const [row] = await this.database.db
      .select()
      .from(workflows)
      .where(eq(workflows.id, id))
      .limit(1);

    return row === undefined ? null : workflowFromRow(row);
  }

  async listWorkflows(): Promise<Workflow[]> {
    const rows = await this.database.db
      .select()
      .from(workflows)
      .orderBy(asc(workflows.createdAt), asc(workflows.id));

    return rows.map(workflowFromRow);
  }

  async saveWorkflowVersion(workflowVersion: WorkflowVersion): Promise<void> {
    const existing = await this.findWorkflowVersionById(workflowVersion.id);

    if (existing) {
      if (isSameWorkflowVersion(existing, workflowVersion)) {
        return;
      }

      throw new DomainInvariantError(
        `WorkflowVersion '${workflowVersion.id}' is immutable and cannot be replaced with different content.`,
      );
    }

    try {
      await this.database.db
        .insert(workflowVersions)
        .values(workflowVersionToRow(workflowVersion));
    } catch (error) {
      if (postgresErrorCode(error) === POSTGRES_UNIQUE_VIOLATION) {
        const constraint = postgresConstraintName(error);

        if (
          constraint === "workflow_versions_id_pk" ||
          constraint === "workflow_versions_pkey"
        ) {
          const stored = await this.findWorkflowVersionById(workflowVersion.id);
          if (stored && isSameWorkflowVersion(stored, workflowVersion)) {
            return;
          }

          throw new DomainInvariantError(
            `WorkflowVersion '${workflowVersion.id}' is immutable and cannot be replaced with different content.`,
          );
        }

        if (constraint === "workflow_versions_workflow_id_version_unique") {
          throw new DomainInvariantError(
            `WorkflowVersion already exists for workflow '${workflowVersion.workflowId}' version ${String(workflowVersion.version)}.`,
          );
        }
      }

      throw mapDatabaseError(error, {
        workflow_versions_workflow_id_version_unique: `WorkflowVersion already exists for workflow '${workflowVersion.workflowId}' version ${String(workflowVersion.version)}.`,
      });
    }
  }

  async appendWorkflowVersion(
    input: AppendWorkflowVersionInput,
  ): Promise<WorkflowVersion> {
    return this.database.db.transaction(async (tx) => {
      const [workflowRow] = await tx
        .select()
        .from(workflows)
        .where(eq(workflows.id, input.workflowId))
        .for("update")
        .limit(1);

      if (workflowRow === undefined) {
        throw new WorkflowNotFoundError(input.workflowId);
      }

      const [aggregate] = await tx
        .select({ maxVersion: max(workflowVersions.version) })
        .from(workflowVersions)
        .where(eq(workflowVersions.workflowId, input.workflowId));

      const nextVersion = (aggregate?.maxVersion ?? 0) + 1;
      const workflowVersion = WorkflowVersion.create({
        id: input.id,
        workflowId: input.workflowId,
        workspaceId: workflowRow.workspaceId as WorkspaceId,
        version: nextVersion,
        definition: input.definition,
        createdAt: input.createdAt,
      });

      try {
        await tx
          .insert(workflowVersions)
          .values(workflowVersionToRow(workflowVersion));
      } catch (error) {
        throw mapDatabaseError(error, {
          workflow_versions_workflow_id_version_unique: `WorkflowVersion already exists for workflow '${input.workflowId}' version ${String(nextVersion)}.`,
        });
      }

      return workflowVersion;
    });
  }

  async findWorkflowVersionById(
    id: WorkflowVersionId,
  ): Promise<WorkflowVersion | null> {
    const [row] = await this.database.db
      .select()
      .from(workflowVersions)
      .where(eq(workflowVersions.id, id))
      .limit(1);

    return row === undefined ? null : workflowVersionFromRow(row);
  }

  async listWorkflowVersions(
    workflowId: WorkflowId,
  ): Promise<WorkflowVersion[]> {
    const rows = await this.database.db
      .select()
      .from(workflowVersions)
      .where(eq(workflowVersions.workflowId, workflowId))
      .orderBy(asc(workflowVersions.version));

    return rows.map(workflowVersionFromRow);
  }
}
