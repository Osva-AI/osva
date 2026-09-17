import type {
  AgentVersionId,
  AssignmentId,
  RunAttemptId,
  RunId,
  WorkflowRunId,
  WorkflowVersionId,
} from "@osva/contracts";
import {
  AssignmentNotFoundError,
  DomainInvariantError,
  isTerminalAssignmentState,
  type AgentRepository,
  type Assignment,
  type OfficeRepository,
  type RunRepository,
  type WorkflowRepository,
  type WorkflowRunRepository,
} from "@osva/domain";
import { WorkflowRun } from "@osva/domain";

import {
  OSVA_SPAN,
  resolveInstrumentation,
  type OsvaInstrumentation,
} from "@osva/observability";

import { assignmentRunIdempotencyKey } from "./assignment-idempotency.js";
import { CreateRun, type CreateRunCommand } from "./create-run.js";
import { EnqueueFailedError } from "./errors.js";
import { ReconcileAssignment } from "./reconcile-assignment.js";

export interface LaunchAssignmentCommand {
  readonly assignmentId: AssignmentId;
  readonly runId: RunId;
  readonly runAttemptId: RunAttemptId;
  readonly workflowRunId: WorkflowRunId;
  readonly now: Date;
}

export interface LaunchAssignmentDependencies {
  readonly office: OfficeRepository;
  readonly agents: AgentRepository;
  readonly workflows: WorkflowRepository;
  readonly workflowRuns: WorkflowRunRepository;
  readonly runs: RunRepository;
  readonly createRun: CreateRun;
  readonly reconcileAssignment: ReconcileAssignment;
  readonly instrumentation?: OsvaInstrumentation;
}

export class LaunchAssignment {
  constructor(private readonly deps: LaunchAssignmentDependencies) {}

  async execute(command: LaunchAssignmentCommand): Promise<Assignment> {
    const telemetry = resolveInstrumentation(this.deps.instrumentation);

    return telemetry.withSpan(
      OSVA_SPAN.ASSIGNMENT_LAUNCH,
      { assignment_id: command.assignmentId },
      async () => this.executeInner(command),
    );
  }

  private async executeInner(
    command: LaunchAssignmentCommand,
  ): Promise<Assignment> {
    const assignment = await this.deps.office.findAssignmentById(
      command.assignmentId,
    );
    if (assignment === null) {
      throw new AssignmentNotFoundError(command.assignmentId);
    }

    if (isTerminalAssignmentState(assignment.status)) {
      return this.deps.reconcileAssignment.execute({
        assignmentId: assignment.id,
        now: command.now,
      });
    }

    if (assignment.targetType === "AGENT_VERSION") {
      return this.launchAgentAssignment(command, assignment);
    }

    return this.launchWorkflowAssignment(command, assignment);
  }

  private async launchAgentAssignment(
    command: LaunchAssignmentCommand,
    assignment: Assignment,
  ): Promise<Assignment> {
    const idempotencyKey = assignmentRunIdempotencyKey(assignment.id);
    const officeWorker = await this.deps.office.findOfficeWorkerById(
      assignment.officeWorkerId,
    );
    if (officeWorker === null) {
      throw new DomainInvariantError(
        `Assignment ${assignment.id} references missing OfficeWorker ${assignment.officeWorkerId}.`,
      );
    }

    let run =
      (assignment.runId === undefined
        ? null
        : await this.deps.runs.findRunById(assignment.runId)) ??
      (await this.deps.runs.findRunByWorkspaceIdempotencyKey(
        assignment.workspaceId,
        idempotencyKey,
      ));

    if (run === null) {
      const createCommand: CreateRunCommand = {
        runId: command.runId,
        runAttemptId: command.runAttemptId,
        workspaceId: assignment.workspaceId,
        agentId: officeWorker.agentId,
        agentVersionId: assignment.targetVersionId as AgentVersionId,
        input: assignment.input,
        idempotencyKey,
        now: command.now,
      };

      try {
        const created = await this.deps.createRun.execute(createCommand);
        run = created.run;
      } catch (error) {
        if (
          error instanceof DomainInvariantError &&
          error.message.includes("idempotency key")
        ) {
          const existing =
            await this.deps.runs.findRunByWorkspaceIdempotencyKey(
              assignment.workspaceId,
              idempotencyKey,
            );
          if (existing !== null) {
            run = existing;
          } else {
            throw error;
          }
        } else if (error instanceof EnqueueFailedError) {
          const existing = await this.deps.runs.findRunById(error.runId);
          if (existing !== null) {
            run = existing;
          } else {
            throw error;
          }
        } else {
          throw error;
        }
      }
    }

    const launched = assignment.markLaunched({
      runId: run.id,
      now: command.now,
    });
    const persisted =
      assignment.status === "PENDING"
        ? await this.deps.office.transitionAssignment(
            assignment.status,
            launched,
          )
        : await this.deps.office.updateAssignment(launched);
    if (persisted === null) {
      throw new AssignmentNotFoundError(assignment.id);
    }

    return this.deps.reconcileAssignment.execute({
      assignmentId: persisted.id,
      now: command.now,
    });
  }

  private async launchWorkflowAssignment(
    command: LaunchAssignmentCommand,
    assignment: Assignment,
  ): Promise<Assignment> {
    let workflowRun =
      assignment.workflowRunId === undefined
        ? null
        : await this.deps.workflowRuns.findWorkflowRunById(
            assignment.workflowRunId,
          );

    if (workflowRun === null) {
      const version = await this.deps.workflows.findWorkflowVersionById(
        assignment.targetVersionId as WorkflowVersionId,
      );
      if (version === null) {
        throw new DomainInvariantError(
          `Assignment ${assignment.id} references missing WorkflowVersion ${assignment.targetVersionId}.`,
        );
      }

      workflowRun = WorkflowRun.create({
        id: command.workflowRunId,
        workspaceId: assignment.workspaceId,
        workflowId: version.workflowId,
        workflowVersionId: version.id,
        input: assignment.input,
        createdAt: command.now,
      });
      await this.deps.workflowRuns.saveWorkflowRun(workflowRun);
    }

    const launched = assignment.markLaunched({
      workflowRunId: workflowRun.id,
      now: command.now,
    });
    const persisted =
      assignment.status === "PENDING"
        ? await this.deps.office.transitionAssignment(
            assignment.status,
            launched,
          )
        : await this.deps.office.updateAssignment(launched);
    if (persisted === null) {
      throw new AssignmentNotFoundError(assignment.id);
    }

    return this.deps.reconcileAssignment.execute({
      assignmentId: persisted.id,
      now: command.now,
    });
  }
}
