import type {
  WorkflowNodeRunId,
  WorkflowRunId,
  WorkflowRunState,
} from "@osva/contracts";

import type { WorkflowNodeRun } from "../workflow-node-run.js";
import type { WorkflowRun } from "../workflow-run.js";

export interface WorkflowRunRepository {
  saveWorkflowRun(workflowRun: WorkflowRun): Promise<void>;
  findWorkflowRunById(id: WorkflowRunId): Promise<WorkflowRun | null>;
  listActiveWorkflowRuns(limit: number): Promise<readonly WorkflowRun[]>;
  transitionWorkflowRun(
    expectedStatus: WorkflowRunState,
    next: WorkflowRun,
  ): Promise<WorkflowRun>;
  saveWorkflowNodeRun(nodeRun: WorkflowNodeRun): Promise<void>;
  findWorkflowNodeRunById(
    id: WorkflowNodeRunId,
  ): Promise<WorkflowNodeRun | null>;
  findWorkflowNodeRunByWorkflowRunAndKey(
    workflowRunId: WorkflowRunId,
    workflowNodeKey: string,
  ): Promise<WorkflowNodeRun | null>;
  listWorkflowNodeRuns(
    workflowRunId: WorkflowRunId,
  ): Promise<readonly WorkflowNodeRun[]>;
  saveWorkflowNodeRunTransition(
    expectedStatus: WorkflowNodeRun["status"],
    next: WorkflowNodeRun,
  ): Promise<WorkflowNodeRun>;
}
