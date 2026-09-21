import type {
  WorkflowDefinition,
  WorkflowId,
  WorkflowVersionId,
  WorkspaceId,
} from "@osva/contracts";

import type { Workflow } from "../workflow.js";
import type { WorkflowVersion } from "../workflow-version.js";

export interface AppendWorkflowVersionInput {
  readonly id: WorkflowVersionId;
  readonly workflowId: WorkflowId;
  readonly definition: WorkflowDefinition;
  readonly createdAt: Date;
}

export interface WorkflowRepository {
  saveWorkflow(workflow: Workflow): Promise<void>;
  findWorkflowById(id: WorkflowId): Promise<Workflow | null>;
  findWorkflowByWorkspaceAndId(
    workspaceId: WorkspaceId,
    id: WorkflowId,
  ): Promise<Workflow | null>;
  listWorkflows(): Promise<Workflow[]>;
  listWorkflowsByWorkspaceId(workspaceId: WorkspaceId): Promise<Workflow[]>;
  saveWorkflowVersion(workflowVersion: WorkflowVersion): Promise<void>;
  appendWorkflowVersion(
    input: AppendWorkflowVersionInput,
  ): Promise<WorkflowVersion>;
  findWorkflowVersionById(
    id: WorkflowVersionId,
  ): Promise<WorkflowVersion | null>;
  listWorkflowVersions(workflowId: WorkflowId): Promise<WorkflowVersion[]>;
}
