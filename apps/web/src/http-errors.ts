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
  EvaluationRunNotFoundError,
  EvaluationSuiteNotFoundError,
  EvaluationSuiteVersionNotFoundError,
  MemoryNamespaceNotFoundError,
  OfficeWorkerNotFoundError,
  TeamNotFoundError,
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
  ApiKeyNotFoundError,
  AuthenticationRequiredError,
  PermissionDeniedError,
  StdioConnectorsDisabledError,
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
import { resolveRequestId } from "./security-request-context.js";
import { sendV1Error } from "./v1-api-error.js";
import { PUBLIC_API_ERROR_CODES } from "@osva/contracts";
import { emitSecurityEvent, SECURITY_EVENT_NAMES } from "@osva/observability";

export function sendHttpError(response: ServerResponse, error: unknown): void {
  const requestId = resolveRequestId();

  if (error instanceof AuthenticationRequiredError) {
    sendV1Error(
      response,
      401,
      PUBLIC_API_ERROR_CODES.AUTHENTICATION_REQUIRED,
      requestId,
    );
    return;
  }

  if (error instanceof PermissionDeniedError) {
    sendV1Error(
      response,
      403,
      PUBLIC_API_ERROR_CODES.PERMISSION_DENIED,
      requestId,
    );
    return;
  }

  if (error instanceof InvalidJsonBodyError) {
    sendJson(response, 400, { status: "invalid_request" });
    return;
  }

  if (error instanceof RequestBodyTooLargeError) {
    sendV1Error(
      response,
      413,
      PUBLIC_API_ERROR_CODES.REQUEST_TOO_LARGE,
      requestId,
    );
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
    error instanceof EvaluationSuiteNotFoundError ||
    error instanceof EvaluationSuiteVersionNotFoundError ||
    error instanceof EvaluationRunNotFoundError ||
    error instanceof MemoryNamespaceNotFoundError ||
    error instanceof OfficeWorkerNotFoundError ||
    error instanceof TeamNotFoundError ||
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
    error instanceof KnowledgeIndexNotFoundError ||
    error instanceof ApiKeyNotFoundError
  ) {
    sendV1Error(
      response,
      404,
      PUBLIC_API_ERROR_CODES.RESOURCE_NOT_FOUND,
      requestId,
    );
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

  if (error instanceof StdioConnectorsDisabledError) {
    emitSecurityEvent({
      event: SECURITY_EVENT_NAMES.CONNECTOR_STDIO_DENIED,
      requestId,
      outcome: "DENIED",
      reasonCode: "stdio_disabled",
    });
    sendV1Error(
      response,
      403,
      PUBLIC_API_ERROR_CODES.PERMISSION_DENIED,
      requestId,
    );
    return;
  }

  if (error instanceof Error && error.name === "OutboundNetworkPolicyError") {
    emitSecurityEvent({
      event: SECURITY_EVENT_NAMES.CONNECTOR_EGRESS_DENIED,
      requestId,
      outcome: "DENIED",
      reasonCode: "outbound_policy",
    });
    sendV1Error(
      response,
      403,
      PUBLIC_API_ERROR_CODES.PERMISSION_DENIED,
      requestId,
    );
    return;
  }

  if (error instanceof Error && error.name === "SecretNotFoundError") {
    emitSecurityEvent({
      event: SECURITY_EVENT_NAMES.CONNECTOR_SECRET_RESOLUTION_FAILED,
      requestId,
      outcome: "DENIED",
      reasonCode: "secret_resolution_failed",
    });
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
