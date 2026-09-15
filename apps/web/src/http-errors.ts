import type { ServerResponse } from "node:http";
import {
  AgentNotFoundError,
  AgentVersionNotFoundError,
  DomainInvariantError,
  DuplicateAgentKeyError,
  WorkspaceNotFoundError,
} from "@osva/domain";

import { InvalidJsonBodyError, sendJson } from "./json.js";

export function sendHttpError(response: ServerResponse, error: unknown): void {
  if (error instanceof InvalidJsonBodyError) {
    sendJson(response, 400, { status: "invalid_request" });
    return;
  }

  if (
    error instanceof AgentNotFoundError ||
    error instanceof AgentVersionNotFoundError ||
    error instanceof WorkspaceNotFoundError
  ) {
    sendJson(response, 404, { status: "not_found" });
    return;
  }

  if (error instanceof DuplicateAgentKeyError) {
    sendJson(response, 409, { status: "conflict" });
    return;
  }

  if (error instanceof DomainInvariantError) {
    sendJson(response, 400, { status: "invalid_request" });
    return;
  }

  sendJson(response, 500, { status: "internal_error" });
}
