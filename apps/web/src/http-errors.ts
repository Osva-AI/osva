import type { ServerResponse } from "node:http";
import {
  AgentNotFoundError,
  AgentVersionNotFoundError,
  DomainInvariantError,
  DuplicateAgentKeyError,
  DuplicateModelProfileKeyError,
  DuplicateToolKeyError,
  DuplicateScheduleKeyError,
  EvaluationNotFoundError,
  InvalidRunAttemptStateError,
  InvalidRunAttemptTransitionError,
  InvalidRunTransitionError,
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
} from "@osva/domain";
import {
  AgentNotFoundError as OrchestrationAgentNotFoundError,
  AgentVersionNotFoundError as OrchestrationAgentVersionNotFoundError,
  BindingMismatchError,
  EnqueueFailedError,
  RunAttemptNotFoundError as OrchestrationRunAttemptNotFoundError,
  RunNotFoundError as OrchestrationRunNotFoundError,
} from "@osva/orchestration";

import { InvalidJsonBodyError, sendJson } from "./json.js";

export function sendHttpError(response: ServerResponse, error: unknown): void {
  if (error instanceof InvalidJsonBodyError) {
    sendJson(response, 400, { status: "invalid_request" });
    return;
  }

  if (
    error instanceof AgentNotFoundError ||
    error instanceof AgentVersionNotFoundError ||
    error instanceof WorkspaceNotFoundError ||
    error instanceof RunNotFoundError ||
    error instanceof RunAttemptNotFoundError ||
    error instanceof ModelProfileNotFoundError ||
    error instanceof ModelProfileVersionNotFoundError ||
    error instanceof ToolNotFoundError ||
    error instanceof ToolVersionNotFoundError ||
    error instanceof RunStepNotFoundError ||
    error instanceof EvaluationNotFoundError ||
    error instanceof ScheduleNotFoundError ||
    error instanceof OrchestrationAgentNotFoundError ||
    error instanceof OrchestrationAgentVersionNotFoundError ||
    error instanceof OrchestrationRunNotFoundError ||
    error instanceof OrchestrationRunAttemptNotFoundError
  ) {
    sendJson(response, 404, { status: "not_found" });
    return;
  }

  if (
    error instanceof DuplicateAgentKeyError ||
    error instanceof DuplicateModelProfileKeyError ||
    error instanceof DuplicateToolKeyError ||
    error instanceof DuplicateScheduleKeyError ||
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
    error instanceof InvalidRunAttemptTransitionError
  ) {
    sendJson(response, 400, { status: "invalid_request" });
    return;
  }

  if (error instanceof EnqueueFailedError) {
    sendJson(response, 500, { status: "internal_error" });
    return;
  }

  sendJson(response, 500, { status: "internal_error" });
}
