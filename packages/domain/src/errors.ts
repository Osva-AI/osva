import type {
  AgentId,
  AgentVersionId,
  ApprovalRequestId,
  ApprovalRequestState,
  ArtifactId,
  ConnectorId,
  ConnectorVersionId,
  EvaluationCaseId,
  EvaluationId,
  EvaluationRunId,
  EvaluationRunState,
  EvaluationSuiteId,
  EvaluationSuiteVersionId,
  MemoryNamespaceId,
  ModelProfileId,
  ModelProfileVersionId,
  RunAttemptId,
  RunAttemptState,
  RunId,
  RunState,
  RunStepId,
  ScheduleId,
  ToolId,
  ToolVersionId,
  WorkflowId,
  WorkflowNodeRunId,
  WorkflowNodeRunState,
  WorkflowRunId,
  WorkflowRunState,
  WorkflowVersionId,
  WorkspaceId,
  OfficeWorkerId,
  RoleId,
  TeamId,
  GoalId,
  AssignmentId,
  AssignmentState,
  GoalState,
  KnowledgeIndexId,
  KnowledgeIndexState,
  KnowledgeSourceId,
  KnowledgeErrorCode,
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

export class ConnectorNotFoundError extends DomainError {
  readonly connectorId: ConnectorId;

  constructor(connectorId: ConnectorId) {
    super(`Connector ${connectorId} was not found.`);
    this.connectorId = connectorId;
  }
}

export class ConnectorVersionNotFoundError extends DomainError {
  readonly connectorVersionId: ConnectorVersionId;

  constructor(connectorVersionId: ConnectorVersionId) {
    super(`ConnectorVersion ${connectorVersionId} was not found.`);
    this.connectorVersionId = connectorVersionId;
  }
}

export class DuplicateConnectorKeyError extends DomainInvariantError {
  readonly workspaceId: WorkspaceId;
  readonly key: string;

  constructor(workspaceId: WorkspaceId, key: string) {
    super(
      `Connector key '${key}' already exists in workspace '${workspaceId}'.`,
    );
    this.workspaceId = workspaceId;
    this.key = key;
  }
}

export class MemoryNamespaceNotFoundError extends DomainError {
  readonly memoryNamespaceId: MemoryNamespaceId;

  constructor(memoryNamespaceId: MemoryNamespaceId) {
    super(`MemoryNamespace ${memoryNamespaceId} was not found.`);
    this.memoryNamespaceId = memoryNamespaceId;
  }
}

export class DuplicateMemoryNamespaceKeyError extends DomainInvariantError {
  readonly workspaceId: WorkspaceId;
  readonly key: string;

  constructor(workspaceId: WorkspaceId, key: string) {
    super(
      `Memory namespace key '${key}' already exists in workspace '${workspaceId}'.`,
    );
    this.workspaceId = workspaceId;
    this.key = key;
  }
}

export class MemoryRecordNotFoundError extends DomainError {
  readonly namespaceId: MemoryNamespaceId;
  readonly key: string;

  constructor(namespaceId: MemoryNamespaceId, key: string) {
    super(
      `Memory record '${key}' was not found in namespace '${namespaceId}'.`,
    );
    this.namespaceId = namespaceId;
    this.key = key;
  }
}

export class MemoryRecordConflictError extends DomainInvariantError {
  readonly namespaceId: MemoryNamespaceId;
  readonly key: string;
  readonly expectedRevision: number | undefined;
  readonly actualRevision: number | undefined;

  constructor(
    namespaceId: MemoryNamespaceId,
    key: string,
    expectedRevision: number | undefined,
    actualRevision: number | undefined,
  ) {
    super(
      expectedRevision === undefined
        ? `Memory record '${key}' already exists in namespace '${namespaceId}'.`
        : `Memory record '${key}' revision conflict in namespace '${namespaceId}'. Expected ${String(expectedRevision)}, found ${actualRevision === undefined ? "none" : String(actualRevision)}.`,
    );
    this.namespaceId = namespaceId;
    this.key = key;
    this.expectedRevision = expectedRevision;
    this.actualRevision = actualRevision;
  }
}

export class DuplicateEvaluationSuiteKeyError extends DomainInvariantError {
  readonly workspaceId: WorkspaceId;
  readonly key: string;

  constructor(workspaceId: WorkspaceId, key: string) {
    super(
      `EvaluationSuite key '${key}' already exists in workspace '${workspaceId}'.`,
    );
    this.workspaceId = workspaceId;
    this.key = key;
  }
}

export class EvaluationSuiteNotFoundError extends DomainError {
  readonly evaluationSuiteId: EvaluationSuiteId;

  constructor(evaluationSuiteId: EvaluationSuiteId) {
    super(`EvaluationSuite ${evaluationSuiteId} was not found.`);
    this.evaluationSuiteId = evaluationSuiteId;
  }
}

export class EvaluationSuiteVersionNotFoundError extends DomainError {
  readonly evaluationSuiteVersionId: EvaluationSuiteVersionId;

  constructor(evaluationSuiteVersionId: EvaluationSuiteVersionId) {
    super(`EvaluationSuiteVersion ${evaluationSuiteVersionId} was not found.`);
    this.evaluationSuiteVersionId = evaluationSuiteVersionId;
  }
}

export class EvaluationCaseNotFoundError extends DomainError {
  readonly evaluationCaseId: EvaluationCaseId;

  constructor(evaluationCaseId: EvaluationCaseId) {
    super(`EvaluationCase ${evaluationCaseId} was not found.`);
    this.evaluationCaseId = evaluationCaseId;
  }
}

export class EvaluationRunNotFoundError extends DomainError {
  readonly evaluationRunId: EvaluationRunId;

  constructor(evaluationRunId: EvaluationRunId) {
    super(`EvaluationRun ${evaluationRunId} was not found.`);
    this.evaluationRunId = evaluationRunId;
  }
}

export class InvalidEvaluationRunTransitionError extends DomainError {
  readonly from: EvaluationRunState;
  readonly to: EvaluationRunState;

  constructor(from: EvaluationRunState, to: EvaluationRunState) {
    super(`Invalid evaluation run transition from ${from} to ${to}.`);
    this.from = from;
    this.to = to;
  }
}

export class InvalidConnectorTransportError extends DomainInvariantError {}

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

export class InvalidMemoryBindingError extends DomainInvariantError {}

export class InvalidKnowledgeBindingError extends DomainInvariantError {}

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

export class ApprovalRequestNotFoundError extends DomainError {
  readonly approvalRequestId: ApprovalRequestId;

  constructor(approvalRequestId: ApprovalRequestId) {
    super(`ApprovalRequest ${approvalRequestId} was not found.`);
    this.approvalRequestId = approvalRequestId;
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

export class InvalidApprovalRequestTransitionError extends DomainError {
  readonly from: ApprovalRequestState;
  readonly to: ApprovalRequestState;

  constructor(from: ApprovalRequestState, to: ApprovalRequestState) {
    super(`Invalid approval request transition from ${from} to ${to}.`);
    this.from = from;
    this.to = to;
  }
}

export class InvalidWorkflowDefinitionError extends DomainInvariantError {}

export class WorkflowDefinitionNotExecutableError extends DomainInvariantError {
  readonly schemaVersion: string;

  constructor(schemaVersion: string) {
    super(
      `Workflow definition schemaVersion '${schemaVersion}' is valid but not yet executable.`,
    );
    this.schemaVersion = schemaVersion;
  }
}

export class WorkflowWaitCorrelationResolutionError extends DomainInvariantError {}

export class WorkflowWaitResolutionConflictError extends DomainInvariantError {
  readonly existing: string;
  readonly attempted: string;

  constructor(existing: string, attempted: string) {
    super(
      `WorkflowWait already resolved as ${existing}; cannot resolve as ${attempted}.`,
    );
    this.existing = existing;
    this.attempted = attempted;
  }
}

export class WorkflowWaitNotFoundError extends DomainError {
  readonly workflowNodeRunId: WorkflowNodeRunId;

  constructor(workflowNodeRunId: WorkflowNodeRunId) {
    super(
      `WorkflowWait for WorkflowNodeRun '${workflowNodeRunId}' was not found.`,
    );
    this.workflowNodeRunId = workflowNodeRunId;
  }
}

export class WorkflowWaitResolutionNotDueError extends DomainInvariantError {
  readonly resolution: string;
  readonly dueAt: Date;
  readonly now: Date;

  constructor(resolution: string, dueAt: Date, now: Date) {
    super(
      `WorkflowWait ${resolution} resolution is not due until ${dueAt.toISOString()}.`,
    );
    this.resolution = resolution;
    this.dueAt = dueAt;
    this.now = now;
  }
}

export class WorkflowWaitEventNotEligibleError extends DomainInvariantError {
  readonly workflowNodeRunId: string;
  readonly workflowEventId: string;

  constructor(workflowNodeRunId: string, workflowEventId: string) {
    super(
      `WorkflowEvent '${workflowEventId}' is not eligible for WorkflowWait '${workflowNodeRunId}'.`,
    );
    this.workflowNodeRunId = workflowNodeRunId;
    this.workflowEventId = workflowEventId;
  }
}

export class WorkflowEventIdempotencyConflictError extends DomainInvariantError {
  readonly workspaceId: WorkspaceId;
  readonly source: string;
  readonly idempotencyKey: string;

  constructor(
    workspaceId: WorkspaceId,
    source: string,
    idempotencyKey: string,
  ) {
    super(
      `WorkflowEvent ingestion identity '${workspaceId}/${source}/${idempotencyKey}' conflicts with an existing event.`,
    );
    this.workspaceId = workspaceId;
    this.source = source;
    this.idempotencyKey = idempotencyKey;
  }
}

export class OfficeWorkerNotFoundError extends DomainError {
  readonly officeWorkerId: OfficeWorkerId;

  constructor(officeWorkerId: OfficeWorkerId) {
    super(`OfficeWorker ${officeWorkerId} was not found.`);
    this.officeWorkerId = officeWorkerId;
  }
}

export class DuplicateOfficeWorkerKeyError extends DomainInvariantError {
  readonly workspaceId: WorkspaceId;
  readonly key: string;

  constructor(workspaceId: WorkspaceId, key: string) {
    super(
      `OfficeWorker key '${key}' already exists in workspace '${workspaceId}'.`,
    );
    this.workspaceId = workspaceId;
    this.key = key;
  }
}

export class RoleNotFoundError extends DomainError {
  readonly roleId: RoleId;

  constructor(roleId: RoleId) {
    super(`Role ${roleId} was not found.`);
    this.roleId = roleId;
  }
}

export class DuplicateRoleKeyError extends DomainInvariantError {
  readonly workspaceId: WorkspaceId;
  readonly key: string;

  constructor(workspaceId: WorkspaceId, key: string) {
    super(`Role key '${key}' already exists in workspace '${workspaceId}'.`);
    this.workspaceId = workspaceId;
    this.key = key;
  }
}

export class TeamNotFoundError extends DomainError {
  readonly teamId: TeamId;

  constructor(teamId: TeamId) {
    super(`Team ${teamId} was not found.`);
    this.teamId = teamId;
  }
}

export class DuplicateTeamKeyError extends DomainInvariantError {
  readonly workspaceId: WorkspaceId;
  readonly key: string;

  constructor(workspaceId: WorkspaceId, key: string) {
    super(`Team key '${key}' already exists in workspace '${workspaceId}'.`);
    this.workspaceId = workspaceId;
    this.key = key;
  }
}

export class DuplicateTeamMembershipError extends DomainInvariantError {
  readonly teamId: TeamId;
  readonly officeWorkerId: OfficeWorkerId;

  constructor(teamId: TeamId, officeWorkerId: OfficeWorkerId) {
    super(
      `OfficeWorker ${officeWorkerId} is already a member of Team ${teamId}.`,
    );
    this.teamId = teamId;
    this.officeWorkerId = officeWorkerId;
  }
}

export class GoalNotFoundError extends DomainError {
  readonly goalId: GoalId;

  constructor(goalId: GoalId) {
    super(`Goal ${goalId} was not found.`);
    this.goalId = goalId;
  }
}

export class DuplicateGoalKeyError extends DomainInvariantError {
  readonly workspaceId: WorkspaceId;
  readonly key: string;

  constructor(workspaceId: WorkspaceId, key: string) {
    super(`Goal key '${key}' already exists in workspace '${workspaceId}'.`);
    this.workspaceId = workspaceId;
    this.key = key;
  }
}

export class AssignmentNotFoundError extends DomainError {
  readonly assignmentId: AssignmentId;

  constructor(assignmentId: AssignmentId) {
    super(`Assignment ${assignmentId} was not found.`);
    this.assignmentId = assignmentId;
  }
}

export class InvalidGoalTransitionError extends DomainError {
  readonly from: GoalState;
  readonly to: GoalState;

  constructor(from: GoalState, to: GoalState) {
    super(`Invalid goal transition from ${from} to ${to}.`);
    this.from = from;
    this.to = to;
  }
}

export class InvalidAssignmentTransitionError extends DomainError {
  readonly from: AssignmentState;
  readonly to: AssignmentState;

  constructor(from: AssignmentState, to: AssignmentState) {
    super(`Invalid assignment transition from ${from} to ${to}.`);
    this.from = from;
    this.to = to;
  }
}

export class LifecycleConflictError extends DomainError {
  readonly entity:
    | "run"
    | "runAttempt"
    | "runStep"
    | "workflowRun"
    | "workflowNodeRun"
    | "approvalRequest"
    | "evaluationRun"
    | "assignment";
  readonly id:
    | RunId
    | RunAttemptId
    | RunStepId
    | WorkflowRunId
    | WorkflowNodeRunId
    | ApprovalRequestId
    | EvaluationRunId
    | AssignmentId;
  readonly expectedStatus:
    | RunState
    | RunAttemptState
    | WorkflowRunState
    | WorkflowNodeRunState
    | ApprovalRequestState
    | EvaluationRunState
    | AssignmentState
    | "RUNNING";

  constructor(
    entity:
      | "run"
      | "runAttempt"
      | "runStep"
      | "workflowRun"
      | "workflowNodeRun"
      | "approvalRequest"
      | "evaluationRun"
      | "assignment",
    id:
      | RunId
      | RunAttemptId
      | RunStepId
      | WorkflowRunId
      | WorkflowNodeRunId
      | ApprovalRequestId
      | EvaluationRunId
      | AssignmentId,
    expectedStatus:
      | RunState
      | RunAttemptState
      | WorkflowRunState
      | WorkflowNodeRunState
      | ApprovalRequestState
      | EvaluationRunState
      | AssignmentState
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

export class ArtifactNotFoundError extends DomainError {
  readonly artifactId: ArtifactId;

  constructor(artifactId: ArtifactId) {
    super(`Artifact ${artifactId} was not found.`);
    this.artifactId = artifactId;
  }
}

export class ArtifactIdempotencyConflictError extends DomainInvariantError {
  readonly workspaceId: WorkspaceId;
  readonly idempotencyKey: string;

  constructor(workspaceId: WorkspaceId, idempotencyKey: string) {
    super(
      `Artifact idempotency key '${idempotencyKey}' conflicts with an existing artifact in workspace '${workspaceId}'.`,
    );
    this.workspaceId = workspaceId;
    this.idempotencyKey = idempotencyKey;
  }
}

export class ArtifactPayloadTooLargeError extends DomainError {
  readonly maxBytes: number;

  constructor(maxBytes: number) {
    super(
      `Artifact content exceeds the configured maximum of ${maxBytes} bytes.`,
    );
    this.maxBytes = maxBytes;
  }
}

export class ArtifactDigestMismatchError extends DomainInvariantError {
  constructor() {
    super("Artifact content digest does not match the expected sha256 digest.");
  }
}

export class ArtifactBlobUnavailableError extends DomainError {
  readonly artifactId: ArtifactId;

  constructor(artifactId: ArtifactId) {
    super(`Artifact ${artifactId} content is unavailable.`);
    this.artifactId = artifactId;
  }
}

export class ArtifactProducerWorkspaceMismatchError extends DomainInvariantError {
  readonly artifactWorkspaceId: WorkspaceId;
  readonly producerRunId: RunId;

  constructor(artifactWorkspaceId: WorkspaceId, producerRunId: RunId) {
    super(
      `Producer Run ${producerRunId} does not belong to workspace ${artifactWorkspaceId}.`,
    );
    this.artifactWorkspaceId = artifactWorkspaceId;
    this.producerRunId = producerRunId;
  }
}

export class ArtifactWorkspaceMismatchError extends DomainError {
  readonly artifactId: ArtifactId;
  readonly workspaceId: WorkspaceId;

  constructor(artifactId: ArtifactId, workspaceId: WorkspaceId) {
    super(
      `Artifact ${artifactId} is not accessible from workspace ${workspaceId}.`,
    );
    this.artifactId = artifactId;
    this.workspaceId = workspaceId;
  }
}

export class KnowledgeError extends DomainError {
  readonly code: KnowledgeErrorCode;

  constructor(code: KnowledgeErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

export class KnowledgeSourceNotFoundError extends KnowledgeError {
  readonly knowledgeSourceId: KnowledgeSourceId;

  constructor(knowledgeSourceId: KnowledgeSourceId) {
    super(
      "KNOWLEDGE_SOURCE_NOT_FOUND",
      `KnowledgeSource ${knowledgeSourceId} was not found.`,
    );
    this.knowledgeSourceId = knowledgeSourceId;
  }
}

export class KnowledgeBindingNotFoundError extends KnowledgeError {
  readonly bindingName: string;

  constructor(bindingName: string) {
    super(
      "KNOWLEDGE_BINDING_NOT_FOUND",
      `Knowledge binding '${bindingName}' was not found for this execution.`,
    );
    this.bindingName = bindingName;
  }
}

export class KnowledgeIndexNotFoundError extends KnowledgeError {
  readonly knowledgeIndexId: KnowledgeIndexId;

  constructor(knowledgeIndexId: KnowledgeIndexId) {
    super(
      "KNOWLEDGE_INDEX_NOT_FOUND",
      `KnowledgeIndex ${knowledgeIndexId} was not found.`,
    );
    this.knowledgeIndexId = knowledgeIndexId;
  }
}

export class KnowledgeIndexNotReadyError extends KnowledgeError {
  readonly knowledgeIndexId: KnowledgeIndexId;

  constructor(knowledgeIndexId: KnowledgeIndexId) {
    super(
      "KNOWLEDGE_INDEX_NOT_READY",
      `KnowledgeIndex ${knowledgeIndexId} is not READY.`,
    );
    this.knowledgeIndexId = knowledgeIndexId;
  }
}

export class KnowledgeIndexNotRetryableError extends KnowledgeError {
  readonly knowledgeIndexId: KnowledgeIndexId;
  readonly currentStatus: string;

  constructor(knowledgeIndexId: KnowledgeIndexId, currentStatus: string) {
    super(
      "KNOWLEDGE_INDEX_NOT_RETRYABLE",
      `KnowledgeIndex ${knowledgeIndexId} cannot be retried from status ${currentStatus}.`,
    );
    this.knowledgeIndexId = knowledgeIndexId;
    this.currentStatus = currentStatus;
  }
}

export class KnowledgeUnsupportedMediaTypeError extends KnowledgeError {
  constructor(mediaType: string) {
    super(
      "KNOWLEDGE_UNSUPPORTED_MEDIA_TYPE",
      `Media type '${mediaType}' is not supported for knowledge ingestion.`,
    );
  }
}

export class KnowledgeExtractionFailedError extends KnowledgeError {
  constructor(message = "Knowledge extraction failed.") {
    super("KNOWLEDGE_EXTRACTION_FAILED", message);
  }
}

export class KnowledgeSourceTooLargeError extends KnowledgeError {
  constructor(message = "Knowledge source exceeds supported size limits.") {
    super("KNOWLEDGE_SOURCE_TOO_LARGE", message);
  }
}

export class KnowledgeEmbeddingFailedError extends KnowledgeError {
  constructor(message = "Knowledge embedding failed.") {
    super("KNOWLEDGE_EMBEDDING_FAILED", message);
  }
}

export class KnowledgeVectorStoreUnavailableError extends KnowledgeError {
  constructor(message = "Knowledge vector store is unavailable.") {
    super("KNOWLEDGE_VECTOR_STORE_UNAVAILABLE", message);
  }
}

export class KnowledgeIncompatibleIndexesError extends KnowledgeError {
  constructor(message = "Knowledge indexes are incompatible for retrieval.") {
    super("KNOWLEDGE_INCOMPATIBLE_INDEXES", message);
  }
}

export class KnowledgeInvalidFilterError extends KnowledgeError {
  constructor(message = "Knowledge filter is invalid.") {
    super("KNOWLEDGE_INVALID_FILTER", message);
  }
}

export class KnowledgeIdempotencyConflictError extends KnowledgeError {
  readonly workspaceId: WorkspaceId;
  readonly idempotencyKey: string;

  constructor(workspaceId: WorkspaceId, idempotencyKey: string) {
    super(
      "KNOWLEDGE_IDEMPOTENCY_CONFLICT",
      `Knowledge idempotency key '${idempotencyKey}' conflicts in workspace '${workspaceId}'.`,
    );
    this.workspaceId = workspaceId;
    this.idempotencyKey = idempotencyKey;
  }
}

export class DuplicateKnowledgeSourceKeyError extends DomainInvariantError {
  readonly workspaceId: WorkspaceId;
  readonly key: string;

  constructor(workspaceId: WorkspaceId, key: string) {
    super(
      `Knowledge source key '${key}' already exists in workspace '${workspaceId}'.`,
    );
    this.workspaceId = workspaceId;
    this.key = key;
  }
}

export class InvalidKnowledgeIndexTransitionError extends DomainError {
  readonly from: KnowledgeIndexState;
  readonly to: KnowledgeIndexState;

  constructor(from: KnowledgeIndexState, to: KnowledgeIndexState) {
    super(`Invalid knowledge index transition from ${from} to ${to}.`);
    this.from = from;
    this.to = to;
  }
}

export class KnowledgeChunkConsistencyError extends DomainInvariantError {
  readonly knowledgeIndexId: KnowledgeIndexId;
  readonly ordinal: number;

  constructor(knowledgeIndexId: KnowledgeIndexId, ordinal: number) {
    super(
      `Knowledge chunk at ordinal ${ordinal} conflicts for index ${knowledgeIndexId}.`,
    );
    this.knowledgeIndexId = knowledgeIndexId;
    this.ordinal = ordinal;
  }
}
