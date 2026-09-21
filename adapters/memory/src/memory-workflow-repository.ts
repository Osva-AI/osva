import type {
  WorkflowId,
  WorkflowVersionId,
  WorkspaceId,
} from "@osva/contracts";
import {
  DomainInvariantError,
  DuplicateWorkflowKeyError,
  WorkflowNotFoundError,
  WorkflowVersion,
  type AppendWorkflowVersionInput,
  type Workflow,
  type WorkflowRepository,
} from "@osva/domain";

export class MemoryWorkflowRepository implements WorkflowRepository {
  private readonly workflows = new Map<WorkflowId, Workflow>();
  private readonly workflowVersions = new Map<
    WorkflowVersionId,
    WorkflowVersion
  >();

  async saveWorkflow(workflow: Workflow): Promise<void> {
    for (const existing of this.workflows.values()) {
      if (
        existing.id !== workflow.id &&
        existing.workspaceId === workflow.workspaceId &&
        existing.key === workflow.key
      ) {
        throw new DuplicateWorkflowKeyError(workflow.workspaceId, workflow.key);
      }
    }

    this.workflows.set(workflow.id, workflow);
  }

  async findWorkflowById(id: WorkflowId): Promise<Workflow | null> {
    return this.workflows.get(id) ?? null;
  }

  async findWorkflowByWorkspaceAndId(
    workspaceId: WorkspaceId,
    id: WorkflowId,
  ): Promise<Workflow | null> {
    const workflow = this.workflows.get(id);
    if (workflow === undefined || workflow.workspaceId !== workspaceId) {
      return null;
    }

    return workflow;
  }

  async listWorkflowsByWorkspaceId(
    workspaceId: WorkspaceId,
  ): Promise<Workflow[]> {
    return [...this.workflows.values()]
      .filter((workflow) => workflow.workspaceId === workspaceId)
      .sort(compareWorkflows);
  }

  async listWorkflows(): Promise<Workflow[]> {
    return [...this.workflows.values()].sort(compareWorkflows);
  }

  async saveWorkflowVersion(workflowVersion: WorkflowVersion): Promise<void> {
    const existing = this.workflowVersions.get(workflowVersion.id);

    if (existing && !isSameWorkflowVersion(existing, workflowVersion)) {
      throw new DomainInvariantError(
        `WorkflowVersion '${workflowVersion.id}' is immutable and cannot be replaced with different content.`,
      );
    }

    if (!existing) {
      for (const stored of this.workflowVersions.values()) {
        if (
          stored.workflowId === workflowVersion.workflowId &&
          stored.version === workflowVersion.version
        ) {
          throw new DomainInvariantError(
            `WorkflowVersion already exists for workflow '${workflowVersion.workflowId}' version ${String(workflowVersion.version)}.`,
          );
        }
      }
    }

    this.workflowVersions.set(workflowVersion.id, existing ?? workflowVersion);
  }

  async appendWorkflowVersion(
    input: AppendWorkflowVersionInput,
  ): Promise<WorkflowVersion> {
    const workflow = this.workflows.get(input.workflowId);
    if (workflow === undefined) {
      throw new WorkflowNotFoundError(input.workflowId);
    }

    let maxVersion = 0;
    for (const stored of this.workflowVersions.values()) {
      if (
        stored.workflowId === input.workflowId &&
        stored.version > maxVersion
      ) {
        maxVersion = stored.version;
      }
    }

    const workflowVersion = WorkflowVersion.create({
      id: input.id,
      workflowId: input.workflowId,
      workspaceId: workflow.workspaceId,
      version: maxVersion + 1,
      definition: input.definition,
      createdAt: input.createdAt,
    });

    await this.saveWorkflowVersion(workflowVersion);
    return workflowVersion;
  }

  async findWorkflowVersionById(
    id: WorkflowVersionId,
  ): Promise<WorkflowVersion | null> {
    return this.workflowVersions.get(id) ?? null;
  }

  async listWorkflowVersions(
    workflowId: WorkflowId,
  ): Promise<WorkflowVersion[]> {
    return [...this.workflowVersions.values()]
      .filter((version) => version.workflowId === workflowId)
      .sort(compareWorkflowVersions);
  }
}

function compareWorkflows(left: Workflow, right: Workflow): number {
  const created = left.createdAt.getTime() - right.createdAt.getTime();
  if (created !== 0) {
    return created;
  }

  if (left.id < right.id) {
    return -1;
  }

  if (left.id > right.id) {
    return 1;
  }

  return 0;
}

function compareWorkflowVersions(
  left: WorkflowVersion,
  right: WorkflowVersion,
): number {
  return left.version - right.version;
}

function isSameWorkflowVersion(
  left: WorkflowVersion,
  right: WorkflowVersion,
): boolean {
  return (
    left.id === right.id &&
    left.workflowId === right.workflowId &&
    left.workspaceId === right.workspaceId &&
    left.version === right.version &&
    left.createdAt.getTime() === right.createdAt.getTime() &&
    JSON.stringify(left.definition) === JSON.stringify(right.definition)
  );
}
