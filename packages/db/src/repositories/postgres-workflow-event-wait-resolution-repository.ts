import type { WorkflowNodeRunId } from "@osva/contracts";
import {
  WorkflowWaitNotFoundError,
  isTerminalWorkflowRunState,
  resolveWorkflowEventWaitDecision,
  type WorkflowEventWaitResolutionRepository,
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
import { selectWorkflowEventCandidatesForWait } from "./postgres-workflow-event-candidates.js";

export class PostgresWorkflowEventWaitResolutionRepository implements WorkflowEventWaitResolutionRepository {
  constructor(private readonly database: Database) {}

  async resolveWorkflowEventWait(
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

      const [row] = await tx
        .select()
        .from(workflowWaits)
        .where(eq(workflowWaits.workflowNodeRunId, workflowNodeRunId))
        .for("update");

      if (row === undefined) {
        throw new WorkflowWaitNotFoundError(workflowNodeRunId);
      }

      const wait = workflowWaitFromRow(row);
      const workflowRun = workflowRunFromRow(runRow);

      if (isTerminalWorkflowRunState(workflowRun.status)) {
        return wait;
      }

      const candidates = await selectWorkflowEventCandidatesForWait(
        tx,
        wait,
        now,
      );
      const outcome = resolveWorkflowEventWaitDecision(wait, candidates, now);

      if (outcome.status === "unchanged") {
        return outcome.wait;
      }

      const resolutionRow = workflowWaitResolutionToRow(outcome.wait);
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
