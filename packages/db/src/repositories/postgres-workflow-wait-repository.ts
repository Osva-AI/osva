import type { WorkflowNodeRunId, WorkflowRunId } from "@osva/contracts";
import {
  DomainInvariantError,
  WorkflowWaitNotFoundError,
  WorkflowWaitResolutionConflictError,
  hasSameDurableWorkflowWaitResolution,
  type WorkflowEventWaitMatchQuery,
  type WorkflowWait,
  type WorkflowWaitRepository,
} from "@osva/domain";
import { and, asc, eq, exists, gte, isNull, lte, or, sql } from "drizzle-orm";

import type { Database } from "../database.js";
import {
  workflowWaitFromRow,
  workflowWaitResolutionToRow,
  workflowWaitToRow,
} from "../mappers/workflow-wait-mapper.js";
import { withMappedDatabaseErrors } from "../postgres-errors.js";
import { workflowEvents } from "../schema/workflow-events.js";
import { workflowRuns } from "../schema/workflow-runs.js";
import { workflowWaits } from "../schema/workflow-waits.js";
import { activeWorkflowRunForWaitDiscovery } from "./postgres-active-workflow-run-filter.js";

export class PostgresWorkflowWaitRepository implements WorkflowWaitRepository {
  constructor(private readonly database: Database) {}

  async saveWorkflowWait(wait: WorkflowWait): Promise<void> {
    await withMappedDatabaseErrors(
      () =>
        this.database.db.insert(workflowWaits).values(workflowWaitToRow(wait)),
      {
        workflow_waits_pkey: `WorkflowWait already exists for WorkflowNodeRun '${wait.workflowNodeRunId}'.`,
      },
    );
  }

  async findWorkflowWaitByWorkflowNodeRunId(
    workflowNodeRunId: WorkflowNodeRunId,
  ): Promise<WorkflowWait | null> {
    const [row] = await this.database.db
      .select()
      .from(workflowWaits)
      .where(eq(workflowWaits.workflowNodeRunId, workflowNodeRunId))
      .limit(1);

    return row === undefined ? null : workflowWaitFromRow(row);
  }

  async listWorkflowWaitsByWorkflowRunId(
    workflowRunId: WorkflowRunId,
  ): Promise<readonly WorkflowWait[]> {
    const rows = await this.database.db
      .select()
      .from(workflowWaits)
      .where(eq(workflowWaits.workflowRunId, workflowRunId))
      .orderBy(
        asc(workflowWaits.armedAt),
        asc(workflowWaits.workflowNodeRunId),
      );

    return rows.map(workflowWaitFromRow);
  }

  async listActiveEventWorkflowWaitsByMatch(
    query: WorkflowEventWaitMatchQuery,
  ): Promise<readonly WorkflowWait[]> {
    const rows = await this.database.db
      .select({ wait: workflowWaits })
      .from(workflowWaits)
      .innerJoin(
        workflowRuns,
        and(
          eq(workflowWaits.workflowRunId, workflowRuns.id),
          eq(workflowWaits.workspaceId, workflowRuns.workspaceId),
        ),
      )
      .where(
        and(
          eq(workflowWaits.kind, "EVENT"),
          isNull(workflowWaits.resolution),
          eq(workflowWaits.workspaceId, query.workspaceId),
          eq(workflowWaits.eventSource, query.source),
          eq(workflowWaits.eventType, query.eventType),
          eq(workflowWaits.correlationKey, query.correlationKey),
          activeWorkflowRunForWaitDiscovery(),
        ),
      )
      .orderBy(asc(workflowWaits.workflowNodeRunId));

    return rows.map((row) => workflowWaitFromRow(row.wait));
  }

  async listResolvableEventWorkflowWaits(
    now: Date,
    limit: number,
  ): Promise<readonly WorkflowWait[]> {
    const rows = await this.database.db
      .select({ wait: workflowWaits })
      .from(workflowWaits)
      .innerJoin(
        workflowRuns,
        and(
          eq(workflowWaits.workflowRunId, workflowRuns.id),
          eq(workflowWaits.workspaceId, workflowRuns.workspaceId),
        ),
      )
      .where(
        and(
          eq(workflowWaits.kind, "EVENT"),
          isNull(workflowWaits.resolution),
          activeWorkflowRunForWaitDiscovery(),
          or(
            and(
              sql`${workflowWaits.expiresAt} is not null`,
              lte(workflowWaits.expiresAt, now),
            ),
            exists(
              this.database.db
                .select({ one: sql`1` })
                .from(workflowEvents)
                .where(
                  and(
                    eq(workflowEvents.workspaceId, workflowWaits.workspaceId),
                    eq(workflowEvents.source, workflowWaits.eventSource),
                    eq(workflowEvents.eventType, workflowWaits.eventType),
                    eq(
                      workflowEvents.correlationKey,
                      workflowWaits.correlationKey,
                    ),
                    gte(workflowEvents.receivedAt, workflowWaits.eligibleFrom),
                    lte(workflowEvents.receivedAt, now),
                    or(
                      isNull(workflowWaits.expiresAt),
                      lte(workflowEvents.receivedAt, workflowWaits.expiresAt),
                    ),
                  ),
                ),
            ),
          ),
        ),
      )
      .orderBy(asc(workflowWaits.armedAt), asc(workflowWaits.workflowNodeRunId))
      .limit(limit);

    return rows.map((row) => workflowWaitFromRow(row.wait));
  }

  async listDueTimerWorkflowWaits(
    now: Date,
    limit: number,
  ): Promise<readonly WorkflowWait[]> {
    const rows = await this.database.db
      .select({ wait: workflowWaits })
      .from(workflowWaits)
      .innerJoin(
        workflowRuns,
        and(
          eq(workflowWaits.workflowRunId, workflowRuns.id),
          eq(workflowWaits.workspaceId, workflowRuns.workspaceId),
        ),
      )
      .where(
        and(
          eq(workflowWaits.kind, "TIMER"),
          isNull(workflowWaits.resolution),
          lte(workflowWaits.wakeAt, now),
          activeWorkflowRunForWaitDiscovery(),
        ),
      )
      .orderBy(asc(workflowWaits.wakeAt), asc(workflowWaits.workflowNodeRunId))
      .limit(limit);

    return rows.map((row) => workflowWaitFromRow(row.wait));
  }

  async saveWorkflowWaitResolution(next: WorkflowWait): Promise<WorkflowWait> {
    if (next.resolution === undefined) {
      throw new DomainInvariantError(
        "saveWorkflowWaitResolution requires a resolved WorkflowWait.",
      );
    }

    const resolutionRow = workflowWaitResolutionToRow(next);
    const [updated] = await this.database.db
      .update(workflowWaits)
      .set(resolutionRow)
      .where(
        and(
          eq(workflowWaits.workflowNodeRunId, next.workflowNodeRunId),
          isNull(workflowWaits.resolution),
        ),
      )
      .returning();

    if (updated !== undefined) {
      return workflowWaitFromRow(updated);
    }

    return this.resolveWorkflowWaitResolutionConflict(next);
  }

  private async resolveWorkflowWaitResolutionConflict(
    next: WorkflowWait,
  ): Promise<WorkflowWait> {
    const existing = await this.findWorkflowWaitByWorkflowNodeRunId(
      next.workflowNodeRunId,
    );
    if (existing === null) {
      throw new WorkflowWaitNotFoundError(next.workflowNodeRunId);
    }

    assertWorkflowWaitResolutionIdentity(existing, next);

    if (
      existing.resolution !== undefined &&
      hasSameDurableWorkflowWaitResolution(existing, next)
    ) {
      return existing;
    }

    if (existing.resolution !== undefined) {
      throw new WorkflowWaitResolutionConflictError(
        existing.resolution,
        next.resolution!,
      );
    }

    throw new DomainInvariantError(
      `WorkflowWait resolution for '${next.workflowNodeRunId}' could not be persisted.`,
    );
  }
}

function assertWorkflowWaitResolutionIdentity(
  existing: WorkflowWait,
  next: WorkflowWait,
): void {
  if (
    existing.workspaceId !== next.workspaceId ||
    existing.workflowRunId !== next.workflowRunId
  ) {
    throw new DomainInvariantError(
      `WorkflowWait identity mismatch for WorkflowNodeRun '${next.workflowNodeRunId}'.`,
    );
  }
}
