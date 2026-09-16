import type {
  WorkflowDefinitionV1,
  WorkflowId,
  WorkflowVersionId,
} from "@osva/contracts";

import type { Workflow } from "../workflow.js";
import type { WorkflowVersion } from "../workflow-version.js";

export interface AppendWorkflowVersionInput {
  readonly id: WorkflowVersionId;
  readonly workflowId: WorkflowId;
  readonly definition: WorkflowDefinitionV1;
  readonly createdAt: Date;
}

export interface WorkflowRepository {
  saveWorkflow(workflow: Workflow): Promise<void>;
  findWorkflowById(id: WorkflowId): Promise<Workflow | null>;
  listWorkflows(): Promise<Workflow[]>;
  saveWorkflowVersion(workflowVersion: WorkflowVersion): Promise<void>;
  appendWorkflowVersion(
    input: AppendWorkflowVersionInput,
  ): Promise<WorkflowVersion>;
  findWorkflowVersionById(
    id: WorkflowVersionId,
  ): Promise<WorkflowVersion | null>;
  listWorkflowVersions(workflowId: WorkflowId): Promise<WorkflowVersion[]>;
}
