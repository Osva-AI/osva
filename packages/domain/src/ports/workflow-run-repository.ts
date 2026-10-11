import type {
  WorkflowId,
  WorkflowNodeRunId,
  WorkflowRunId,
  WorkflowRunState,
  WorkflowVersionId,
  WorkspaceId,
} from "@osva-ai/contracts";

import type { WorkflowNodeRun } from "../workflow-node-run.js";
import type { WorkflowRun } from "../workflow-run.js";

export const DEFAULT_WORKFLOW_RUN_LIST_LIMIT = 50;
export const MAX_WORKFLOW_RUN_LIST_LIMIT = 100;

export interface WorkflowRunListCursor {
  readonly createdAt: Date;
  readonly id: WorkflowRunId;
}

export interface ListWorkflowRunsQuery {
  readonly workspaceId: WorkspaceId;
  readonly limit: number;
  readonly cursor?: WorkflowRunListCursor;
  readonly workflowId?: WorkflowId;
  readonly workflowVersionId?: WorkflowVersionId;
  readonly status?: WorkflowRunState;
}

export interface ListWorkflowRunsResult {
  readonly workflowRuns: readonly WorkflowRun[];
  readonly nextCursor?: WorkflowRunListCursor;
}

export interface WorkflowRunRepository {
  saveWorkflowRun(workflowRun: WorkflowRun): Promise<void>;
  findWorkflowRunById(id: WorkflowRunId): Promise<WorkflowRun | null>;
  findWorkflowRunByWorkspaceAndId(
    workspaceId: WorkspaceId,
    id: WorkflowRunId,
  ): Promise<WorkflowRun | null>;
  listActiveWorkflowRuns(limit: number): Promise<readonly WorkflowRun[]>;
  listWorkflowRuns(
    query: ListWorkflowRunsQuery,
  ): Promise<ListWorkflowRunsResult>;
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
