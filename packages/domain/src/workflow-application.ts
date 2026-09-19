import type {
  AgentVersionId,
  ApprovalDecision,
  ApprovalRequestId,
  WorkflowDefinition,
  WorkflowId,
  WorkflowRunId,
  WorkflowVersionId,
  WorkspaceId,
} from "@osva/contracts";

import { ApprovalRequest } from "./approval-request.js";
import { isTerminalApprovalRequestState } from "./approval-request-state-machine.js";
import {
  AgentVersionNotFoundError,
  ApprovalRequestNotFoundError,
  DomainInvariantError,
  LifecycleConflictError,
  WorkflowNotFoundError,
  WorkflowRunNotFoundError,
  WorkflowVersionNotFoundError,
  WorkspaceNotFoundError,
} from "./errors.js";
import type { AgentRepository } from "./ports/agent-repository.js";
import type { ApprovalRequestRepository } from "./ports/approval-request-repository.js";
import type { WorkflowRepository } from "./ports/workflow-repository.js";
import type { WorkflowRunRepository } from "./ports/workflow-run-repository.js";
import type { WorkspaceRepository } from "./ports/workspace-repository.js";
import { Workflow } from "./workflow.js";
import {
  listAgentNodes,
  assertWorkflowDefinitionExecutable,
} from "./workflow-definition.js";
import { WorkflowRun } from "./workflow-run.js";
import type { WorkflowNodeRun } from "./workflow-node-run.js";
import type { WorkflowVersion } from "./workflow-version.js";

export interface WorkflowApplicationClock {
  now(): Date;
}

export interface WorkflowApplicationIds {
  createId(): string;
}

export interface WorkflowApplicationDependencies {
  readonly workflows: WorkflowRepository;
  readonly workflowRuns: WorkflowRunRepository;
  readonly approvalRequests: ApprovalRequestRepository;
  readonly agents: AgentRepository;
  readonly workspaces: WorkspaceRepository;
  readonly clock: WorkflowApplicationClock;
  readonly ids: WorkflowApplicationIds;
}

export interface CreateWorkflowCommand {
  readonly workspaceId: WorkspaceId;
  readonly key: string;
  readonly name: string;
  readonly description?: string;
}

export interface AppendWorkflowVersionCommand {
  readonly workflowId: WorkflowId;
  readonly definition: WorkflowDefinition;
}

export interface GetWorkflowVersionCommand {
  readonly workflowId: WorkflowId;
  readonly workflowVersionId: WorkflowVersionId;
}

export interface CreateWorkflowRunCommand {
  readonly workspaceId: WorkspaceId;
  readonly workflowVersionId: WorkflowVersionId;
  readonly input: unknown;
}

export interface WorkflowRunView {
  readonly workflowRun: WorkflowRun;
  readonly nodeRuns: readonly WorkflowNodeRun[];
  readonly approvalRequests: readonly ApprovalRequest[];
}

export interface GetApprovalRequestCommand {
  readonly workspaceId: WorkspaceId;
  readonly approvalRequestId: ApprovalRequestId;
}

export interface DecideApprovalRequestCommand {
  readonly workspaceId: WorkspaceId;
  readonly approvalRequestId: ApprovalRequestId;
  readonly decision: ApprovalDecision;
  readonly comment?: string;
}

export class CreateWorkflow {
  constructor(private readonly deps: WorkflowApplicationDependencies) {}

  async execute(command: CreateWorkflowCommand): Promise<Workflow> {
    const workspace = await this.deps.workspaces.findById(command.workspaceId);
    if (workspace === null) {
      throw new WorkspaceNotFoundError(command.workspaceId);
    }

    const now = this.deps.clock.now();
    const workflow = Workflow.create({
      id: this.deps.ids.createId() as WorkflowId,
      workspaceId: command.workspaceId,
      key: command.key,
      name: command.name,
      description: command.description,
      createdAt: now,
      updatedAt: now,
    });

    await this.deps.workflows.saveWorkflow(workflow);
    return workflow;
  }
}

export class GetWorkflow {
  constructor(private readonly deps: WorkflowApplicationDependencies) {}

  async execute(workflowId: WorkflowId): Promise<Workflow> {
    const workflow = await this.deps.workflows.findWorkflowById(workflowId);
    if (workflow === null) {
      throw new WorkflowNotFoundError(workflowId);
    }

    return workflow;
  }
}

export class ListWorkflows {
  constructor(private readonly deps: WorkflowApplicationDependencies) {}

  async execute(): Promise<Workflow[]> {
    return this.deps.workflows.listWorkflows();
  }
}

export class AppendWorkflowVersion {
  constructor(private readonly deps: WorkflowApplicationDependencies) {}

  async execute(
    command: AppendWorkflowVersionCommand,
  ): Promise<WorkflowVersion> {
    const workflow = await this.deps.workflows.findWorkflowById(
      command.workflowId,
    );
    if (workflow === null) {
      throw new WorkflowNotFoundError(command.workflowId);
    }

    await assertAgentVersionBindings(
      this.deps.agents,
      workflow.workspaceId,
      command.definition,
    );

    return this.deps.workflows.appendWorkflowVersion({
      id: this.deps.ids.createId() as WorkflowVersionId,
      workflowId: command.workflowId,
      definition: command.definition,
      createdAt: this.deps.clock.now(),
    });
  }
}

export class GetWorkflowVersion {
  constructor(private readonly deps: WorkflowApplicationDependencies) {}

  async execute(command: GetWorkflowVersionCommand): Promise<WorkflowVersion> {
    const workflow = await this.deps.workflows.findWorkflowById(
      command.workflowId,
    );
    if (workflow === null) {
      throw new WorkflowNotFoundError(command.workflowId);
    }

    const version = await this.deps.workflows.findWorkflowVersionById(
      command.workflowVersionId,
    );
    if (version === null || version.workflowId !== command.workflowId) {
      throw new WorkflowVersionNotFoundError(command.workflowVersionId);
    }

    return version;
  }
}

export class ListWorkflowVersions {
  constructor(private readonly deps: WorkflowApplicationDependencies) {}

  async execute(workflowId: WorkflowId): Promise<WorkflowVersion[]> {
    const workflow = await this.deps.workflows.findWorkflowById(workflowId);
    if (workflow === null) {
      throw new WorkflowNotFoundError(workflowId);
    }

    return this.deps.workflows.listWorkflowVersions(workflowId);
  }
}

export class CreateWorkflowRun {
  constructor(private readonly deps: WorkflowApplicationDependencies) {}

  async execute(command: CreateWorkflowRunCommand): Promise<WorkflowRun> {
    const workspace = await this.deps.workspaces.findById(command.workspaceId);
    if (workspace === null) {
      throw new WorkspaceNotFoundError(command.workspaceId);
    }

    const version = await this.deps.workflows.findWorkflowVersionById(
      command.workflowVersionId,
    );
    if (version === null || version.workspaceId !== command.workspaceId) {
      throw new WorkflowVersionNotFoundError(command.workflowVersionId);
    }

    const workflow = await this.deps.workflows.findWorkflowById(
      version.workflowId,
    );
    if (workflow === null) {
      throw new WorkflowNotFoundError(version.workflowId);
    }

    assertWorkflowDefinitionExecutable(version.definition);

    const workflowRun = WorkflowRun.create({
      id: this.deps.ids.createId() as WorkflowRunId,
      workspaceId: command.workspaceId,
      workflowId: version.workflowId,
      workflowVersionId: version.id,
      input: command.input,
      createdAt: this.deps.clock.now(),
    });

    await this.deps.workflowRuns.saveWorkflowRun(workflowRun);
    return workflowRun;
  }
}

export class GetWorkflowRun {
  constructor(private readonly deps: WorkflowApplicationDependencies) {}

  async execute(workflowRunId: WorkflowRunId): Promise<WorkflowRunView> {
    const workflowRun =
      await this.deps.workflowRuns.findWorkflowRunById(workflowRunId);
    if (workflowRun === null) {
      throw new WorkflowRunNotFoundError(workflowRunId);
    }

    const nodeRuns =
      await this.deps.workflowRuns.listWorkflowNodeRuns(workflowRunId);
    const approvalRequests =
      await this.deps.approvalRequests.listApprovalRequestsByWorkflowRunId(
        workflowRunId,
      );

    return { workflowRun, nodeRuns, approvalRequests };
  }
}

export class GetApprovalRequest {
  constructor(private readonly deps: WorkflowApplicationDependencies) {}

  async execute(command: GetApprovalRequestCommand): Promise<ApprovalRequest> {
    const request =
      await this.deps.approvalRequests.findApprovalRequestByWorkspaceAndId(
        command.workspaceId,
        command.approvalRequestId,
      );
    if (request === null) {
      throw new ApprovalRequestNotFoundError(command.approvalRequestId);
    }

    return request;
  }
}

export class DecideApprovalRequest {
  constructor(private readonly deps: WorkflowApplicationDependencies) {}

  async execute(
    command: DecideApprovalRequestCommand,
  ): Promise<ApprovalRequest> {
    const existing =
      await this.deps.approvalRequests.findApprovalRequestByWorkspaceAndId(
        command.workspaceId,
        command.approvalRequestId,
      );
    if (existing === null) {
      throw new ApprovalRequestNotFoundError(command.approvalRequestId);
    }

    if (isTerminalApprovalRequestState(existing.status)) {
      if (existing.status === command.decision) {
        return existing;
      }

      throw new LifecycleConflictError(
        "approvalRequest",
        existing.id,
        existing.status,
      );
    }

    const now = this.deps.clock.now();
    const next =
      command.decision === "APPROVED"
        ? existing.markApproved(now, command.comment)
        : existing.markRejected(now, command.comment);

    try {
      return await this.deps.approvalRequests.saveApprovalRequestTransition(
        "PENDING",
        next,
      );
    } catch (error) {
      if (!(error instanceof LifecycleConflictError)) {
        throw error;
      }

      const reloaded =
        await this.deps.approvalRequests.findApprovalRequestByWorkspaceAndId(
          command.workspaceId,
          command.approvalRequestId,
        );
      if (reloaded === null) {
        throw new ApprovalRequestNotFoundError(command.approvalRequestId);
      }

      if (reloaded.status === command.decision) {
        return reloaded;
      }

      throw new LifecycleConflictError(
        "approvalRequest",
        reloaded.id,
        reloaded.status,
      );
    }
  }
}

export interface WorkflowApplication {
  readonly createWorkflow: CreateWorkflow;
  readonly getWorkflow: GetWorkflow;
  readonly listWorkflows: ListWorkflows;
  readonly appendWorkflowVersion: AppendWorkflowVersion;
  readonly getWorkflowVersion: GetWorkflowVersion;
  readonly listWorkflowVersions: ListWorkflowVersions;
  readonly createWorkflowRun: CreateWorkflowRun;
  readonly getWorkflowRun: GetWorkflowRun;
  readonly getApprovalRequest: GetApprovalRequest;
  readonly decideApprovalRequest: DecideApprovalRequest;
}

export function createWorkflowApplication(
  deps: WorkflowApplicationDependencies,
): WorkflowApplication {
  return {
    createWorkflow: new CreateWorkflow(deps),
    getWorkflow: new GetWorkflow(deps),
    listWorkflows: new ListWorkflows(deps),
    appendWorkflowVersion: new AppendWorkflowVersion(deps),
    getWorkflowVersion: new GetWorkflowVersion(deps),
    listWorkflowVersions: new ListWorkflowVersions(deps),
    createWorkflowRun: new CreateWorkflowRun(deps),
    getWorkflowRun: new GetWorkflowRun(deps),
    getApprovalRequest: new GetApprovalRequest(deps),
    decideApprovalRequest: new DecideApprovalRequest(deps),
  };
}

async function assertAgentVersionBindings(
  agents: AgentRepository,
  workspaceId: WorkspaceId,
  definition: WorkflowDefinition,
): Promise<void> {
  for (const node of listAgentNodes(definition)) {
    if (!("agentVersionId" in node)) {
      continue;
    }

    const agentVersionId = node.agentVersionId as AgentVersionId;
    const agentVersion = await agents.findAgentVersionById(agentVersionId);
    if (agentVersion === null) {
      throw new AgentVersionNotFoundError(agentVersionId);
    }

    const agent = await agents.findAgentById(agentVersion.agentId);
    if (agent === null || agent.workspaceId !== workspaceId) {
      throw new DomainInvariantError(
        `Workflow node '${node.key}' references AgentVersion '${agentVersionId}' that does not belong to workspace '${workspaceId}'.`,
      );
    }
  }
}
