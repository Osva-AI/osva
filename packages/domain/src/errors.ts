import type {
  AgentId,
  AgentVersionId,
  EvaluationId,
  ModelProfileId,
  ModelProfileVersionId,
  ScheduleId,
  ToolId,
  ToolVersionId,
  RunAttemptId,
  RunAttemptState,
  RunId,
  RunState,
  RunStepId,
  WorkflowId,
  WorkflowNodeRunId,
  WorkflowNodeRunState,
  WorkflowRunId,
  WorkflowRunState,
  WorkflowVersionId,
  WorkspaceId,
} from "@osva/contracts";

export class DomainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class DomainInvariantError extends DomainError {}

export class InvalidRunTransitionError extends DomainError {
  readonly from: RunState;
  readonly to: RunState;

  constructor(from: RunState, to: RunState) {
    super(`Invalid run transition from ${from} to ${to}.`);
    this.from = from;
    this.to = to;
  }
}

export class InvalidRunAttemptTransitionError extends DomainError {
  readonly from: RunAttemptState;
  readonly to: RunAttemptState;

  constructor(from: RunAttemptState, to: RunAttemptState) {
    super(`Invalid run attempt transition from ${from} to ${to}.`);
    this.from = from;
    this.to = to;
  }
}

export class InvalidAttemptSequenceError extends DomainError {
  constructor(message: string) {
    super(message);
  }
}

export class AgentNotFoundError extends DomainError {
  readonly agentId: AgentId;

  constructor(agentId: AgentId) {
    super(`Agent ${agentId} was not found.`);
    this.agentId = agentId;
  }
}

export class AgentVersionNotFoundError extends DomainError {
  readonly agentVersionId: AgentVersionId;

  constructor(agentVersionId: AgentVersionId) {
    super(`AgentVersion ${agentVersionId} was not found.`);
    this.agentVersionId = agentVersionId;
  }
}

export class WorkspaceNotFoundError extends DomainError {
  readonly workspaceId: WorkspaceId;

  constructor(workspaceId: WorkspaceId) {
    super(`Workspace ${workspaceId} was not found.`);
    this.workspaceId = workspaceId;
  }
}

export class DuplicateAgentKeyError extends DomainInvariantError {
  readonly workspaceId: WorkspaceId;
  readonly key: string;

  constructor(workspaceId: WorkspaceId, key: string) {
    super(`Agent key '${key}' already exists in workspace '${workspaceId}'.`);
    this.workspaceId = workspaceId;
    this.key = key;
  }
}

export class ModelProfileNotFoundError extends DomainError {
  readonly modelProfileId: ModelProfileId;

  constructor(modelProfileId: ModelProfileId) {
    super(`ModelProfile ${modelProfileId} was not found.`);
    this.modelProfileId = modelProfileId;
  }
}

export class ModelProfileVersionNotFoundError extends DomainError {
  readonly modelProfileVersionId: ModelProfileVersionId;

  constructor(modelProfileVersionId: ModelProfileVersionId) {
    super(`ModelProfileVersion ${modelProfileVersionId} was not found.`);
    this.modelProfileVersionId = modelProfileVersionId;
  }
}

export class DuplicateModelProfileKeyError extends DomainInvariantError {
  readonly workspaceId: WorkspaceId;
  readonly key: string;

  constructor(workspaceId: WorkspaceId, key: string) {
    super(
      `ModelProfile key '${key}' already exists in workspace '${workspaceId}'.`,
    );
    this.workspaceId = workspaceId;
    this.key = key;
  }
}

export class InvalidModelBindingError extends DomainInvariantError {}

export class ToolNotFoundError extends DomainError {
  readonly toolId: ToolId;

  constructor(toolId: ToolId) {
    super(`Tool ${toolId} was not found.`);
    this.toolId = toolId;
  }
}

export class ToolVersionNotFoundError extends DomainError {
  readonly toolVersionId: ToolVersionId;

  constructor(toolVersionId: ToolVersionId) {
    super(`ToolVersion ${toolVersionId} was not found.`);
    this.toolVersionId = toolVersionId;
  }
}

export class DuplicateToolKeyError extends DomainInvariantError {
  readonly workspaceId: WorkspaceId;
  readonly key: string;

  constructor(workspaceId: WorkspaceId, key: string) {
    super(`Tool key '${key}' already exists in workspace '${workspaceId}'.`);
    this.workspaceId = workspaceId;
    this.key = key;
  }
}

export class DuplicateScheduleKeyError extends DomainInvariantError {
  readonly workspaceId: WorkspaceId;
  readonly key: string;

  constructor(workspaceId: WorkspaceId, key: string) {
    super(
      `Schedule key '${key}' already exists in workspace '${workspaceId}'.`,
    );
    this.workspaceId = workspaceId;
    this.key = key;
  }
}

export class ScheduleNotFoundError extends DomainError {
  readonly scheduleId: ScheduleId;

  constructor(scheduleId: ScheduleId) {
    super(`Schedule ${scheduleId} was not found.`);
    this.scheduleId = scheduleId;
  }
}

export class InvalidToolBindingError extends DomainInvariantError {}

export class InvalidSubsequentAttemptError extends DomainInvariantError {
  readonly previousStatus: RunAttemptState;

  constructor(previousStatus: RunAttemptState) {
    super(
      previousStatus === "SUCCEEDED"
        ? "A successful RunAttempt cannot be followed by another attempt."
        : `A subsequent RunAttempt requires the previous attempt to be FAILED, TIMED_OUT, or CANCELLED. Previous status was ${previousStatus}.`,
    );
    this.previousStatus = previousStatus;
  }
}

export class RunNotFoundError extends DomainError {
  readonly runId: RunId;

  constructor(runId: RunId) {
    super(`Run ${runId} was not found.`);
    this.runId = runId;
  }
}

export class RunAttemptNotFoundError extends DomainError {
  readonly runAttemptId: RunAttemptId;

  constructor(runAttemptId: RunAttemptId) {
    super(`RunAttempt ${runAttemptId} was not found.`);
    this.runAttemptId = runAttemptId;
  }
}

export class RunStepNotFoundError extends DomainError {
  readonly runStepId: RunStepId;

  constructor(runStepId: RunStepId) {
    super(`RunStep ${runStepId} was not found.`);
    this.runStepId = runStepId;
  }
}

export class EvaluationNotFoundError extends DomainError {
  readonly evaluationId: EvaluationId;

  constructor(evaluationId: EvaluationId) {
    super(`Evaluation ${evaluationId} was not found.`);
    this.evaluationId = evaluationId;
  }
}

export class InvalidRunAttemptStateError extends DomainError {
  readonly runAttemptId: RunAttemptId;
  readonly actualStatus: RunAttemptState;
  readonly requiredStatus: RunAttemptState;

  constructor(
    runAttemptId: RunAttemptId,
    actualStatus: RunAttemptState,
    requiredStatus: RunAttemptState,
  ) {
    super(
      `RunAttempt ${runAttemptId} is ${actualStatus}, expected ${requiredStatus}.`,
    );
    this.runAttemptId = runAttemptId;
    this.actualStatus = actualStatus;
    this.requiredStatus = requiredStatus;
  }
}

export class DuplicateWorkflowKeyError extends DomainInvariantError {
  readonly workspaceId: WorkspaceId;
  readonly key: string;

  constructor(workspaceId: WorkspaceId, key: string) {
    super(
      `Workflow key '${key}' already exists in workspace '${workspaceId}'.`,
    );
    this.workspaceId = workspaceId;
    this.key = key;
  }
}

export class WorkflowNotFoundError extends DomainError {
  readonly workflowId: WorkflowId;

  constructor(workflowId: WorkflowId) {
    super(`Workflow ${workflowId} was not found.`);
    this.workflowId = workflowId;
  }
}

export class WorkflowVersionNotFoundError extends DomainError {
  readonly workflowVersionId: WorkflowVersionId;

  constructor(workflowVersionId: WorkflowVersionId) {
    super(`WorkflowVersion ${workflowVersionId} was not found.`);
    this.workflowVersionId = workflowVersionId;
  }
}

export class WorkflowRunNotFoundError extends DomainError {
  readonly workflowRunId: WorkflowRunId;

  constructor(workflowRunId: WorkflowRunId) {
    super(`WorkflowRun ${workflowRunId} was not found.`);
    this.workflowRunId = workflowRunId;
  }
}

export class WorkflowNodeRunNotFoundError extends DomainError {
  readonly workflowNodeRunId: WorkflowNodeRunId;

  constructor(workflowNodeRunId: WorkflowNodeRunId) {
    super(`WorkflowNodeRun ${workflowNodeRunId} was not found.`);
    this.workflowNodeRunId = workflowNodeRunId;
  }
}

export class InvalidWorkflowRunTransitionError extends DomainError {
  readonly from: WorkflowRunState;
  readonly to: WorkflowRunState;

  constructor(from: WorkflowRunState, to: WorkflowRunState) {
    super(`Invalid workflow run transition from ${from} to ${to}.`);
    this.from = from;
    this.to = to;
  }
}

export class InvalidWorkflowNodeRunTransitionError extends DomainError {
  readonly from: WorkflowNodeRunState;
  readonly to: WorkflowNodeRunState;

  constructor(from: WorkflowNodeRunState, to: WorkflowNodeRunState) {
    super(`Invalid workflow node run transition from ${from} to ${to}.`);
    this.from = from;
    this.to = to;
  }
}

export class InvalidWorkflowDefinitionError extends DomainInvariantError {}

export class LifecycleConflictError extends DomainError {
  readonly entity:
    "run" | "runAttempt" | "runStep" | "workflowRun" | "workflowNodeRun";
  readonly id:
    RunId | RunAttemptId | RunStepId | WorkflowRunId | WorkflowNodeRunId;
  readonly expectedStatus:
    | RunState
    | RunAttemptState
    | WorkflowRunState
    | WorkflowNodeRunState
    | "RUNNING";

  constructor(
    entity:
      "run" | "runAttempt" | "runStep" | "workflowRun" | "workflowNodeRun",
    id: RunId | RunAttemptId | RunStepId | WorkflowRunId | WorkflowNodeRunId,
    expectedStatus:
      | RunState
      | RunAttemptState
      | WorkflowRunState
      | WorkflowNodeRunState
      | "RUNNING",
  ) {
    super(
      `Persisted ${entity} ${id} was not in expected status ${expectedStatus}.`,
    );
    this.entity = entity;
    this.id = id;
    this.expectedStatus = expectedStatus;
  }
}
