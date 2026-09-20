import type { ServerResponse } from "node:http";
import {
  AgentNotFoundError,
  AgentVersionNotFoundError,
  ConnectorNotFoundError,
  ConnectorVersionNotFoundError,
  DomainInvariantError,
  DuplicateAgentKeyError,
  DuplicateConnectorKeyError,
  DuplicateModelProfileKeyError,
  DuplicateToolKeyError,
  DuplicateScheduleKeyError,
  DuplicateWorkflowKeyError,
  EvaluationNotFoundError,
  InvalidRunAttemptStateError,
  InvalidRunAttemptTransitionError,
  InvalidRunTransitionError,
  InvalidWorkflowNodeRunTransitionError,
  InvalidWorkflowRunTransitionError,
  InvalidApprovalRequestTransitionError,
  LifecycleConflictError,
  ModelProfileNotFoundError,
  ModelProfileVersionNotFoundError,
  ToolNotFoundError,
  ToolVersionNotFoundError,
  RunAttemptNotFoundError,
  RunNotFoundError,
  RunStepNotFoundError,
  ScheduleNotFoundError,
  WorkspaceNotFoundError,
  ApprovalRequestNotFoundError,
  WorkflowNotFoundError,
  WorkflowNodeRunNotFoundError,
  WorkflowRunNotFoundError,
  WorkflowVersionNotFoundError,
  WorkflowEventIdempotencyConflictError,
  ArtifactNotFoundError,
  ArtifactIdempotencyConflictError,
  ArtifactPayloadTooLargeError,
  ArtifactDigestMismatchError,
  ArtifactBlobUnavailableError,
  KnowledgeError,
  KnowledgeIdempotencyConflictError,
  KnowledgeIndexNotFoundError,
  KnowledgeIndexNotRetryableError,
  KnowledgeIndexNotReadyError,
  KnowledgeSourceNotFoundError,
  KnowledgeInvalidFilterError,
  KnowledgeIncompatibleIndexesError,
} from "@osva/domain";
import {
  AgentNotFoundError as OrchestrationAgentNotFoundError,
  AgentVersionNotFoundError as OrchestrationAgentVersionNotFoundError,
  BindingMismatchError,
  EnqueueFailedError,
  RunAttemptNotFoundError as OrchestrationRunAttemptNotFoundError,
  RunNotFoundError as OrchestrationRunNotFoundError,
} from "@osva/orchestration";

import {
  InvalidJsonBodyError,
  RequestBodyTooLargeError,
  sendJson,
} from "./json.js";

export function sendHttpError(response: ServerResponse, error: unknown): void {
  if (error instanceof InvalidJsonBodyError) {
    sendJson(response, 400, { status: "invalid_request" });
    return;
  }

  if (error instanceof RequestBodyTooLargeError) {
    sendJson(response, 413, { status: "payload_too_large" });
    return;
  }

  if (error instanceof WorkflowEventIdempotencyConflictError) {
    sendJson(response, 409, { status: "conflict" });
    return;
  }

  if (error instanceof ArtifactIdempotencyConflictError) {
    sendJson(response, 409, { status: "conflict" });
    return;
  }

  if (error instanceof KnowledgeIdempotencyConflictError) {
    sendJson(response, 409, { status: "conflict", code: error.code });
    return;
  }

  if (error instanceof KnowledgeInvalidFilterError) {
    sendJson(response, 400, { status: "invalid_request", code: error.code });
    return;
  }

  if (error instanceof KnowledgeIncompatibleIndexesError) {
    sendJson(response, 400, { status: "invalid_request", code: error.code });
    return;
  }

  if (error instanceof KnowledgeIndexNotReadyError) {
    sendJson(response, 409, { status: "conflict", code: error.code });
    return;
  }

  if (error instanceof ArtifactPayloadTooLargeError) {
    sendJson(response, 413, { status: "payload_too_large" });
    return;
  }

  if (error instanceof ArtifactDigestMismatchError) {
    sendJson(response, 400, { status: "invalid_request" });
    return;
  }

  if (
    error instanceof AgentNotFoundError ||
    error instanceof AgentVersionNotFoundError ||
    error instanceof WorkspaceNotFoundError ||
    error instanceof RunNotFoundError ||
    error instanceof RunAttemptNotFoundError ||
    error instanceof ConnectorNotFoundError ||
    error instanceof ConnectorVersionNotFoundError ||
    error instanceof ModelProfileNotFoundError ||
    error instanceof ModelProfileVersionNotFoundError ||
    error instanceof ToolNotFoundError ||
    error instanceof ToolVersionNotFoundError ||
    error instanceof RunStepNotFoundError ||
    error instanceof EvaluationNotFoundError ||
    error instanceof ScheduleNotFoundError ||
    error instanceof WorkflowNotFoundError ||
    error instanceof WorkflowVersionNotFoundError ||
    error instanceof WorkflowRunNotFoundError ||
    error instanceof WorkflowNodeRunNotFoundError ||
    error instanceof ApprovalRequestNotFoundError ||
    error instanceof OrchestrationAgentNotFoundError ||
    error instanceof OrchestrationAgentVersionNotFoundError ||
    error instanceof OrchestrationRunNotFoundError ||
    error instanceof OrchestrationRunAttemptNotFoundError ||
    error instanceof ArtifactNotFoundError ||
    error instanceof KnowledgeSourceNotFoundError ||
    error instanceof KnowledgeIndexNotFoundError
  ) {
    sendJson(response, 404, { status: "not_found" });
    return;
  }

  if (error instanceof KnowledgeIndexNotRetryableError) {
    sendJson(response, 409, {
      status: "conflict",
      code: error.code,
    });
    return;
  }

  if (error instanceof KnowledgeError) {
    sendJson(response, 502, { status: "unavailable", code: error.code });
    return;
  }

  if (
    error instanceof DuplicateAgentKeyError ||
    error instanceof DuplicateConnectorKeyError ||
    error instanceof DuplicateModelProfileKeyError ||
    error instanceof DuplicateToolKeyError ||
    error instanceof DuplicateScheduleKeyError ||
    error instanceof DuplicateWorkflowKeyError ||
    error instanceof LifecycleConflictError ||
    error instanceof InvalidRunAttemptStateError
  ) {
    sendJson(response, 409, { status: "conflict" });
    return;
  }

  if (
    error instanceof DomainInvariantError ||
    error instanceof BindingMismatchError ||
    error instanceof InvalidRunTransitionError ||
    error instanceof InvalidRunAttemptTransitionError ||
    error instanceof InvalidWorkflowRunTransitionError ||
    error instanceof InvalidWorkflowNodeRunTransitionError ||
    error instanceof InvalidApprovalRequestTransitionError
  ) {
    sendJson(response, 400, { status: "invalid_request" });
    return;
  }

  if (error instanceof EnqueueFailedError) {
    sendJson(response, 500, { status: "internal_error" });
    return;
  }

  if (error instanceof ArtifactBlobUnavailableError) {
    sendJson(response, 503, { status: "unavailable" });
    return;
  }

  sendJson(response, 500, { status: "internal_error" });
}
