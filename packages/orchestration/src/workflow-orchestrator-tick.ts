import type { WorkflowRun } from "@osva/domain";
import type { WorkflowRunRepository } from "@osva/domain";

import {
  ReconcileWorkflowRun,
  type ReconcileWorkflowRunIds,
} from "./reconcile-workflow-run.js";

const DEFAULT_ACTIVE_WORKFLOW_RUN_LIMIT = 50;

export interface WorkflowOrchestratorTickDependencies {
  readonly workflowRuns: WorkflowRunRepository;
  readonly reconcile: ReconcileWorkflowRun;
  readonly limit?: number;
  readonly logger?: {
    info(event: string, fields: Record<string, string>): void;
    error(event: string, fields: Record<string, string>): void;
  };
}

export class WorkflowOrchestratorTick {
  constructor(private readonly deps: WorkflowOrchestratorTickDependencies) {}

  async execute(now: Date, ids: ReconcileWorkflowRunIds): Promise<void> {
    const limit = this.deps.limit ?? DEFAULT_ACTIVE_WORKFLOW_RUN_LIMIT;
    const active = await this.deps.workflowRuns.listActiveWorkflowRuns(limit);

    for (const workflowRun of active) {
      await this.reconcileOne(workflowRun, now, ids);
    }
  }

  private async reconcileOne(
    workflowRun: WorkflowRun,
    now: Date,
    ids: ReconcileWorkflowRunIds,
  ): Promise<void> {
    try {
      await this.deps.reconcile.execute({ workflowRun, now, ids });
    } catch (error) {
      this.deps.logger?.error("workflow.orchestrator.reconcile_failed", {
        workflowRunId: workflowRun.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
