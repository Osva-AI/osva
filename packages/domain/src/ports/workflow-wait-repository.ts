import type {
  WorkflowNodeRunId,
  WorkflowRunId,
  WorkspaceId,
} from "@osva/contracts";

import type { WorkflowWait } from "../workflow-wait.js";

export interface WorkflowEventWaitMatchQuery {
  readonly workspaceId: WorkspaceId;
  readonly source: string;
  readonly eventType: string;
  readonly correlationKey: string;
}

export interface WorkflowWaitRepository {
  saveWorkflowWait(wait: WorkflowWait): Promise<void>;

  findWorkflowWaitByWorkflowNodeRunId(
    workflowNodeRunId: WorkflowNodeRunId,
  ): Promise<WorkflowWait | null>;

  listWorkflowWaitsByWorkflowRunId(
    workflowRunId: WorkflowRunId,
  ): Promise<readonly WorkflowWait[]>;

  saveWorkflowWaitResolution(next: WorkflowWait): Promise<WorkflowWait>;

  listDueTimerWorkflowWaits(
    now: Date,
    limit: number,
  ): Promise<readonly WorkflowWait[]>;

  listActiveEventWorkflowWaitsByMatch(
    query: WorkflowEventWaitMatchQuery,
  ): Promise<readonly WorkflowWait[]>;

  listResolvableEventWorkflowWaits(
    now: Date,
    limit: number,
  ): Promise<readonly WorkflowWait[]>;
}
