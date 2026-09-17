import type {
  WorkflowNodeRunId,
  WorkflowRunId,
  WorkflowRunState,
} from "@osva/contracts";
import {
  DomainInvariantError,
  LifecycleConflictError,
  WorkflowNodeRunNotFoundError,
  WorkflowRunNotFoundError,
  assertLegalWorkflowNodeRunTransition,
  assertLegalWorkflowRunTransition,
  type WorkflowNodeRun,
  type WorkflowRun,
  type WorkflowRunRepository,
} from "@osva/domain";
import { and, asc, eq, inArray } from "drizzle-orm";

import type { Database } from "../database.js";
import {
  workflowNodeRunFromRow,
  workflowNodeRunToRow,
} from "../mappers/workflow-node-run-mapper.js";
import {
  workflowRunFromRow,
  workflowRunToRow,
} from "../mappers/workflow-run-mapper.js";
import { withMappedDatabaseErrors } from "../postgres-errors.js";
import { workflowNodeRuns } from "../schema/workflow-node-runs.js";
import { workflowRuns } from "../schema/workflow-runs.js";

export class PostgresWorkflowRunRepository implements WorkflowRunRepository {
  constructor(private readonly database: Database) {}

  async saveWorkflowRun(workflowRun: WorkflowRun): Promise<void> {
    await withMappedDatabaseErrors(
      () =>
        this.database.db
          .insert(workflowRuns)
          .values(workflowRunToRow(workflowRun)),
      {
        workflow_runs_pkey: `A WorkflowRun with id '${workflowRun.id}' already exists.`,
      },
    );
  }

  async findWorkflowRunById(id: WorkflowRunId): Promise<WorkflowRun | null> {
    const [row] = await this.database.db
      .select()
      .from(workflowRuns)
      .where(eq(workflowRuns.id, id))
      .limit(1);

    return row === undefined ? null : workflowRunFromRow(row);
  }

  async listActiveWorkflowRuns(limit: number): Promise<readonly WorkflowRun[]> {
    const rows = await this.database.db
      .select()
      .from(workflowRuns)
      .where(
        inArray(workflowRuns.status, [
          "PENDING",
          "RUNNING",
          "WAITING_FOR_APPROVAL",
        ]),
      )
      .orderBy(asc(workflowRuns.createdAt), asc(workflowRuns.id))
      .limit(limit);

    return rows.map(workflowRunFromRow);
  }

  async transitionWorkflowRun(
    expectedStatus: WorkflowRunState,
    next: WorkflowRun,
  ): Promise<WorkflowRun> {
    assertLegalWorkflowRunTransition(expectedStatus, next.status);
    const rowValues = workflowRunToRow(next);

    const [row] = await this.database.db
      .update(workflowRuns)
      .set({
        status: rowValues.status,
        output: rowValues.output,
        error: rowValues.error,
        startedAt: rowValues.startedAt,
        completedAt: rowValues.completedAt,
        updatedAt: rowValues.updatedAt,
      })
      .where(
        and(
          eq(workflowRuns.id, next.id),
          eq(workflowRuns.status, expectedStatus),
        ),
      )
      .returning();

    if (row !== undefined) {
      return workflowRunFromRow(row);
    }

    const existing = await this.findWorkflowRunById(next.id);
    if (existing === null) {
      throw new WorkflowRunNotFoundError(next.id);
    }

    throw new LifecycleConflictError("workflowRun", next.id, expectedStatus);
  }

  async saveWorkflowNodeRun(nodeRun: WorkflowNodeRun): Promise<void> {
    const existing = await this.findWorkflowNodeRunById(nodeRun.id);
    const row = workflowNodeRunToRow(nodeRun);

    if (existing) {
      if (
        existing.childRunId !== undefined &&
        nodeRun.childRunId !== undefined &&
        existing.childRunId !== nodeRun.childRunId
      ) {
        throw new DomainInvariantError(
          `WorkflowNodeRun '${nodeRun.id}' already has child Run '${existing.childRunId}'.`,
        );
      }

      await this.database.db
        .update(workflowNodeRuns)
        .set({
          childRunId: row.childRunId,
          updatedAt: row.updatedAt,
        })
        .where(eq(workflowNodeRuns.id, nodeRun.id));
      return;
    }

    await withMappedDatabaseErrors(
      () => this.database.db.insert(workflowNodeRuns).values(row),
      {
        workflow_node_runs_pkey: `A WorkflowNodeRun with id '${nodeRun.id}' already exists.`,
        workflow_node_runs_workflow_run_id_key_unique: `WorkflowNodeRun already exists for workflow run '${nodeRun.workflowRunId}' node '${nodeRun.workflowNodeKey}'.`,
        workflow_node_runs_workflow_run_id_sequence_unique: `WorkflowNodeRun sequence ${String(nodeRun.sequence)} already exists for workflow run '${nodeRun.workflowRunId}'.`,
        workflow_node_runs_child_run_id_unique: nodeRun.childRunId
          ? `Child Run '${nodeRun.childRunId}' is already attached to a WorkflowNodeRun.`
          : "Child Run is already attached to a WorkflowNodeRun.",
      },
    );
  }

  async findWorkflowNodeRunById(
    id: WorkflowNodeRunId,
  ): Promise<WorkflowNodeRun | null> {
    const [row] = await this.database.db
      .select()
      .from(workflowNodeRuns)
      .where(eq(workflowNodeRuns.id, id))
      .limit(1);

    return row === undefined ? null : workflowNodeRunFromRow(row);
  }

  async findWorkflowNodeRunByWorkflowRunAndKey(
    workflowRunId: WorkflowRunId,
    workflowNodeKey: string,
  ): Promise<WorkflowNodeRun | null> {
    const [row] = await this.database.db
      .select()
      .from(workflowNodeRuns)
      .where(
        and(
          eq(workflowNodeRuns.workflowRunId, workflowRunId),
          eq(workflowNodeRuns.workflowNodeKey, workflowNodeKey),
        ),
      )
      .limit(1);

    return row === undefined ? null : workflowNodeRunFromRow(row);
  }

  async listWorkflowNodeRuns(
    workflowRunId: WorkflowRunId,
  ): Promise<readonly WorkflowNodeRun[]> {
    const rows = await this.database.db
      .select()
      .from(workflowNodeRuns)
      .where(eq(workflowNodeRuns.workflowRunId, workflowRunId))
      .orderBy(asc(workflowNodeRuns.sequence));

    return rows.map(workflowNodeRunFromRow);
  }

  async saveWorkflowNodeRunTransition(
    expectedStatus: WorkflowNodeRun["status"],
    next: WorkflowNodeRun,
  ): Promise<WorkflowNodeRun> {
    assertLegalWorkflowNodeRunTransition(expectedStatus, next.status);
    const rowValues = workflowNodeRunToRow(next);

    const [row] = await this.database.db
      .update(workflowNodeRuns)
      .set({
        status: rowValues.status,
        output: rowValues.output,
        childRunId: rowValues.childRunId,
        selectedTargetKey: rowValues.selectedTargetKey,
        error: rowValues.error,
        startedAt: rowValues.startedAt,
        completedAt: rowValues.completedAt,
        updatedAt: rowValues.updatedAt,
      })
      .where(
        and(
          eq(workflowNodeRuns.id, next.id),
          eq(workflowNodeRuns.status, expectedStatus),
        ),
      )
      .returning();

    if (row !== undefined) {
      return workflowNodeRunFromRow(row);
    }

    const existing = await this.findWorkflowNodeRunById(next.id);
    if (existing === null) {
      throw new WorkflowNodeRunNotFoundError(next.id);
    }

    throw new LifecycleConflictError(
      "workflowNodeRun",
      next.id,
      expectedStatus,
    );
  }
}
