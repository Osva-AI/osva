import type { AssignmentId } from "@osva/contracts";
import {
  AssignmentNotFoundError,
  isTerminalAssignmentState,
  TERMINAL_WORKFLOW_RUN_STATES,
  type Assignment,
  type OfficeRepository,
  type RunRepository,
  type WorkflowRunRepository,
} from "@osva/domain";

export interface ReconcileAssignmentCommand {
  readonly assignmentId: AssignmentId;
  readonly now: Date;
}

export interface ReconcileAssignmentDependencies {
  readonly office: OfficeRepository;
  readonly runs: RunRepository;
  readonly workflowRuns: WorkflowRunRepository;
}

export class ReconcileAssignment {
  constructor(private readonly deps: ReconcileAssignmentDependencies) {}

  async execute(command: ReconcileAssignmentCommand): Promise<Assignment> {
    const assignment = await this.deps.office.findAssignmentById(
      command.assignmentId,
    );
    if (assignment === null) {
      throw new AssignmentNotFoundError(command.assignmentId);
    }

    if (isTerminalAssignmentState(assignment.status)) {
      return assignment;
    }

    const derivedStatus = await this.deriveStatus(assignment);
    if (derivedStatus === assignment.status) {
      return assignment;
    }

    const transitioned = assignment.transitionTo(derivedStatus, {
      now: command.now,
      completedAt:
        derivedStatus === "COMPLETED" ? command.now : assignment.completedAt,
      cancelledAt:
        derivedStatus === "CANCELLED" ? command.now : assignment.cancelledAt,
    });

    return this.deps.office.transitionAssignment(
      assignment.status,
      transitioned,
    );
  }

  private async deriveStatus(
    assignment: Assignment,
  ): Promise<Assignment["status"]> {
    if (assignment.targetType === "AGENT_VERSION") {
      if (assignment.runId === undefined) {
        return assignment.status;
      }

      const run = await this.deps.runs.findRunById(assignment.runId);
      if (run === null) {
        return assignment.status;
      }

      if (run.status === "SUCCEEDED") {
        return "COMPLETED";
      }

      if (run.status === "FAILED" || run.status === "TIMED_OUT") {
        return "FAILED";
      }

      if (run.status === "CANCELLED") {
        return "CANCELLED";
      }

      if (
        run.status === "RUNNING" ||
        run.status === "QUEUED" ||
        run.status === "PENDING"
      ) {
        return assignment.status === "PENDING" ? "RUNNING" : "RUNNING";
      }

      return assignment.status;
    }

    if (assignment.workflowRunId === undefined) {
      return assignment.status;
    }

    const workflowRun = await this.deps.workflowRuns.findWorkflowRunById(
      assignment.workflowRunId,
    );
    if (workflowRun === null) {
      return assignment.status;
    }

    if (workflowRun.status === "SUCCEEDED") {
      return "COMPLETED";
    }

    if (workflowRun.status === "FAILED") {
      return "FAILED";
    }

    if (
      workflowRun.status === "RUNNING" ||
      workflowRun.status === "WAITING" ||
      workflowRun.status === "PENDING"
    ) {
      return assignment.status === "PENDING" ? "RUNNING" : "RUNNING";
    }

    if (
      (TERMINAL_WORKFLOW_RUN_STATES as readonly string[]).includes(
        workflowRun.status,
      )
    ) {
      return assignment.status;
    }

    return assignment.status;
  }
}
