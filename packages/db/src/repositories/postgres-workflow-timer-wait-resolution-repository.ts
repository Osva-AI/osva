import type { WorkflowNodeRunId } from "@osva/contracts";
import {
  WorkflowWaitNotFoundError,
  isTerminalWorkflowRunState,
  type WorkflowTimerWaitResolutionRepository,
  type WorkflowWait,
} from "@osva/domain";
import { and, eq, isNull } from "drizzle-orm";

import type { Database } from "../database.js";
import { workflowRunFromRow } from "../mappers/workflow-run-mapper.js";
import {
  workflowWaitFromRow,
  workflowWaitResolutionToRow,
} from "../mappers/workflow-wait-mapper.js";
import { workflowRuns } from "../schema/workflow-runs.js";
import { workflowWaits } from "../schema/workflow-waits.js";

export class PostgresWorkflowTimerWaitResolutionRepository implements WorkflowTimerWaitResolutionRepository {
  constructor(private readonly database: Database) {}

  async resolveWorkflowTimerWait(
    workflowNodeRunId: WorkflowNodeRunId,
    now: Date,
  ): Promise<WorkflowWait> {
    return this.database.db.transaction(async (tx) => {
      const [identity] = await tx
        .select({
          workspaceId: workflowWaits.workspaceId,
          workflowRunId: workflowWaits.workflowRunId,
        })
        .from(workflowWaits)
        .where(eq(workflowWaits.workflowNodeRunId, workflowNodeRunId))
        .limit(1);

      if (identity === undefined) {
        throw new WorkflowWaitNotFoundError(workflowNodeRunId);
      }

      const [runRow] = await tx
        .select()
        .from(workflowRuns)
        .where(
          and(
            eq(workflowRuns.id, identity.workflowRunId),
            eq(workflowRuns.workspaceId, identity.workspaceId),
          ),
        )
        .for("update");

      if (runRow === undefined) {
        throw new WorkflowWaitNotFoundError(workflowNodeRunId);
      }

      const [waitRow] = await tx
        .select()
        .from(workflowWaits)
        .where(eq(workflowWaits.workflowNodeRunId, workflowNodeRunId))
        .for("update");

      if (waitRow === undefined) {
        throw new WorkflowWaitNotFoundError(workflowNodeRunId);
      }

      const wait = workflowWaitFromRow(waitRow);
      const workflowRun = workflowRunFromRow(runRow);

      if (isTerminalWorkflowRunState(workflowRun.status)) {
        return wait;
      }

      if (wait.resolution !== undefined) {
        return wait;
      }

      if (wait.kind !== "TIMER") {
        return wait;
      }

      const resolved = wait.resolveTimer(now);
      const resolutionRow = workflowWaitResolutionToRow(resolved);
      const [updated] = await tx
        .update(workflowWaits)
        .set(resolutionRow)
        .where(
          and(
            eq(workflowWaits.workflowNodeRunId, workflowNodeRunId),
            isNull(workflowWaits.resolution),
          ),
        )
        .returning();

      if (updated === undefined) {
        const [latest] = await tx
          .select()
          .from(workflowWaits)
          .where(eq(workflowWaits.workflowNodeRunId, workflowNodeRunId));
        if (latest === undefined) {
          throw new WorkflowWaitNotFoundError(workflowNodeRunId);
        }
        return workflowWaitFromRow(latest);
      }

      return workflowWaitFromRow(updated);
    });
  }
}
