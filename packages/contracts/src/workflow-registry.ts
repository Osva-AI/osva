import type {
  WorkflowId,
  WorkflowNodeRunId,
  WorkflowRunId,
  WorkflowVersionId,
  WorkspaceId,
} from "./ids.js";
import type { JsonValue } from "./json-value.js";
import type { WorkflowDefinition } from "./workflow-definition.js";
import type {
  WorkflowNodeRunState,
  WorkflowRunState,
} from "./workflow-state.js";

export interface CreateWorkflowRequestV1 {
  readonly workspaceId: WorkspaceId;
  readonly key: string;
  readonly name: string;
  readonly description?: string;
}

export interface CreateWorkflowVersionRequestV1 {
  readonly definition: WorkflowDefinition;
}

export interface CreateWorkflowRunRequestV1 {
  readonly workspaceId: WorkspaceId;
  readonly workflowVersionId: WorkflowVersionId;
  readonly input: JsonValue;
}

export interface WorkflowResourceV1 {
  readonly id: WorkflowId;
  readonly workspaceId: WorkspaceId;
  readonly key: string;
  readonly name: string;
  readonly description?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface WorkflowVersionResourceV1 {
  readonly id: WorkflowVersionId;
  readonly workflowId: WorkflowId;
  readonly workspaceId: WorkspaceId;
  readonly version: number;
  readonly definition: WorkflowDefinition;
  readonly createdAt: string;
}

export interface WorkflowListResourceV1 {
  readonly workflows: readonly WorkflowResourceV1[];
}

export interface WorkflowVersionListResourceV1 {
  readonly versions: readonly WorkflowVersionResourceV1[];
}

export interface WorkflowRunErrorResourceV1 {
  readonly code: string;
  readonly message: string;
}

export interface WorkflowNodeRunResourceV1 {
  readonly id: WorkflowNodeRunId;
  readonly workspaceId: WorkspaceId;
  readonly workflowRunId: WorkflowRunId;
  readonly workflowNodeKey: string;
  readonly sequence: number;
  readonly status: WorkflowNodeRunState;
  readonly input: JsonValue;
  readonly output?: JsonValue;
  readonly childRunId?: string;
  readonly selectedTargetKey?: string;
  readonly error?: WorkflowRunErrorResourceV1;
  readonly startedAt?: string;
  readonly completedAt?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface WorkflowRunResourceV1 {
  readonly id: WorkflowRunId;
  readonly workspaceId: WorkspaceId;
  readonly workflowId: WorkflowId;
  readonly workflowVersionId: WorkflowVersionId;
  readonly status: WorkflowRunState;
  readonly input: JsonValue;
  readonly output?: JsonValue;
  readonly error?: WorkflowRunErrorResourceV1;
  readonly startedAt?: string;
  readonly completedAt?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly nodeRuns: readonly WorkflowNodeRunResourceV1[];
}
