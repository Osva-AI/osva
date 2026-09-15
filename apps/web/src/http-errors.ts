import type { ServerResponse } from "node:http";
import {
  AgentNotFoundError,
  AgentVersionNotFoundError,
  DomainInvariantError,
  DuplicateAgentKeyError,
  InvalidRunAttemptTransitionError,
  InvalidRunTransitionError,
  LifecycleConflictError,
  RunAttemptNotFoundError,
  RunNotFoundError,
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
    error instanceof LifecycleConflictError
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
