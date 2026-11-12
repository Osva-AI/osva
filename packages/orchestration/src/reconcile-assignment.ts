import type {
  AssignmentId,
  RunId,
  WorkflowRunId,
  WorkspaceId,
} from "@osva-ai/contracts";
import {
  AssignmentNotFoundError,
  isTerminalAssignmentState,
  TERMINAL_WORKFLOW_RUN_STATES,
  type Assignment,
  type OfficeRepository,
  type Run,
  type RunRepository,
  type WorkflowRun,
  type WorkflowRunRepository,
} from "@osva/domain";

export interface ReconcileAssignmentCommand {
  readonly assignmentId: AssignmentId;
  readonly workspaceId: WorkspaceId;
  readonly now: Date;
}

export interface ReconcileAssignmentListCommand {
  readonly workspaceId: WorkspaceId;
  readonly now: Date;
  readonly assignments: readonly Assignment[];
}

export interface ReconcileAssignmentDependencies {
  readonly office: OfficeRepository;
  readonly runs: RunRepository;
  readonly workflowRuns: WorkflowRunRepository;
}

export class ReconcileAssignment {
  constructor(private readonly deps: ReconcileAssignmentDependencies) {}

  async execute(command: ReconcileAssignmentCommand): Promise<Assignment> {
    const assignment = await this.deps.office.findAssignmentByWorkspaceAndId(
      command.workspaceId,
      command.assignmentId,
    );
    if (assignment === null) {
      throw new AssignmentNotFoundError(command.assignmentId);
    }

    if (isTerminalAssignmentState(assignment.status)) {
      return assignment;
    }

    const derivedStatus = await this.deriveStatus(assignment);
    return this.materializeDerivedStatus(
      assignment,
      derivedStatus,
      command.now,
    );
  }

  async executeList(
    command: ReconcileAssignmentListCommand,
  ): Promise<readonly Assignment[]> {
    if (command.assignments.length === 0) {
      return command.assignments;
    }

    const active = command.assignments.filter(
      (assignment) => !isTerminalAssignmentState(assignment.status),
    );
    if (active.length === 0) {
      return command.assignments;
    }

    const runById = await this.loadRunsForAssignments(active);
    const workflowRunById = await this.loadWorkflowRunsForAssignments(active);

    const updatedById = new Map<AssignmentId, Assignment>();
    for (const assignment of command.assignments) {
      updatedById.set(assignment.id, assignment);
    }

    for (const assignment of active) {
      const derivedStatus = deriveAssignmentStatusFromExecution(
        assignment,
        runById,
        workflowRunById,
      );
      const next = await this.materializeDerivedStatus(
        assignment,
        derivedStatus,
        command.now,
      );
      updatedById.set(assignment.id, next);
    }

    return command.assignments.map((assignment) =>
      updatedById.get(assignment.id)!,
    );
  }

  private async materializeDerivedStatus(
    assignment: Assignment,
    derivedStatus: Assignment["status"],
    now: Date,
  ): Promise<Assignment> {
    if (derivedStatus === assignment.status) {
      return assignment;
    }

    const transitioned = assignment.transitionTo(derivedStatus, {
      now,
      completedAt: derivedStatus === "COMPLETED" ? now : assignment.completedAt,
      cancelledAt: derivedStatus === "CANCELLED" ? now : assignment.cancelledAt,
    });

    return this.deps.office.transitionAssignment(
      assignment.status,
      transitioned,
    );
  }

  private async deriveStatus(
    assignment: Assignment,
  ): Promise<Assignment["status"]> {
    if (isTerminalAssignmentState(assignment.status)) {
      return assignment.status;
    }

    if (assignment.targetType === "AGENT_VERSION") {
      if (assignment.runId === undefined) {
        return assignment.status;
      }

      const run = await this.deps.runs.findRunById(assignment.runId);
      return deriveAssignmentStatusFromRun(assignment, run);
    }

    if (assignment.workflowRunId === undefined) {
      return assignment.status;
    }

    const workflowRun = await this.deps.workflowRuns.findWorkflowRunById(
      assignment.workflowRunId,
    );
    return deriveAssignmentStatusFromWorkflowRun(assignment, workflowRun);
  }

  private async loadRunsForAssignments(
    assignments: readonly Assignment[],
  ): Promise<ReadonlyMap<RunId, Run>> {
    const runIds = [
      ...new Set(
        assignments
          .filter(
            (assignment) =>
              assignment.targetType === "AGENT_VERSION" &&
              assignment.runId !== undefined,
          )
          .map((assignment) => assignment.runId!),
      ),
    ];
    if (runIds.length === 0) {
      return new Map();
    }

    const runs = await Promise.all(
      runIds.map((runId) => this.deps.runs.findRunById(runId)),
    );
    const runById = new Map<RunId, Run>();
    for (const run of runs) {
      if (run !== null) {
        runById.set(run.id, run);
      }
    }
    return runById;
  }

  private async loadWorkflowRunsForAssignments(
    assignments: readonly Assignment[],
  ): Promise<ReadonlyMap<WorkflowRunId, WorkflowRun>> {
    const workflowRunIds = [
      ...new Set(
        assignments
          .filter(
            (assignment) =>
              assignment.targetType === "WORKFLOW_VERSION" &&
              assignment.workflowRunId !== undefined,
          )
          .map((assignment) => assignment.workflowRunId!),
      ),
    ];
    if (workflowRunIds.length === 0) {
      return new Map();
    }

    const workflowRuns = await Promise.all(
      workflowRunIds.map((workflowRunId) =>
        this.deps.workflowRuns.findWorkflowRunById(workflowRunId),
      ),
    );
    const workflowRunById = new Map<WorkflowRunId, WorkflowRun>();
    for (const workflowRun of workflowRuns) {
      if (workflowRun !== null) {
        workflowRunById.set(workflowRun.id, workflowRun);
      }
    }
    return workflowRunById;
  }
}

function deriveAssignmentStatusFromExecution(
  assignment: Assignment,
  runById: ReadonlyMap<RunId, Run>,
  workflowRunById: ReadonlyMap<WorkflowRunId, WorkflowRun>,
): Assignment["status"] {
  if (isTerminalAssignmentState(assignment.status)) {
    return assignment.status;
  }

  if (assignment.targetType === "AGENT_VERSION") {
    if (assignment.runId === undefined) {
      return assignment.status;
    }

    return deriveAssignmentStatusFromRun(
      assignment,
      runById.get(assignment.runId) ?? null,
    );
  }

  if (assignment.workflowRunId === undefined) {
    return assignment.status;
  }

  return deriveAssignmentStatusFromWorkflowRun(
    assignment,
    workflowRunById.get(assignment.workflowRunId) ?? null,
  );
}

function deriveAssignmentStatusFromRun(
  assignment: Assignment,
  run: Run | null,
): Assignment["status"] {
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
    return "RUNNING";
  }

  return assignment.status;
}

function deriveAssignmentStatusFromWorkflowRun(
  assignment: Assignment,
  workflowRun: WorkflowRun | null,
): Assignment["status"] {
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
    return "RUNNING";
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
