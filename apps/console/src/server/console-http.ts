import type { ServerResponse } from "node:http";

import { OsvaApiError, OsvaTransportError } from "@osva-ai/sdk";

import { ConsoleUpstreamHttpError } from "./human-session-upstream.js";
import {
  ConsoleInvalidJsonBodyError,
  ConsoleRequestBodyTooLargeError,
} from "./read-json-body.js";
import {
  assertSafeSerializedResponse,
  type ResponseSecurityOptions,
} from "./response-security.js";

export interface ConsoleErrorBody {
  readonly error: string;
  readonly code?: string;
  readonly requestId?: string;
}

export function sendJson(
  response: ServerResponse,
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
  security: ResponseSecurityOptions = {},
): void {
  const serialized = JSON.stringify(body);
  assertSafeSerializedResponse(serialized, security);
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...headers,
  });
  response.end(serialized);
}

export function mapOsvaError(error: unknown): {
  status: number;
  body: ConsoleErrorBody;
  requestId?: string;
} {
  if (error instanceof ConsoleRequestBodyTooLargeError) {
    return {
      status: 413,
      body: {
        error: error.message,
        code: "request_too_large",
      },
    };
  }

  if (error instanceof ConsoleInvalidJsonBodyError) {
    return {
      status: 400,
      body: {
        error: error.message,
        code: "invalid_request",
      },
    };
  }

  if (error instanceof ConsoleUpstreamHttpError) {
    const code =
      typeof error.body.status === "string" ? error.body.status : undefined;
    const message =
      typeof error.body.message === "string"
        ? error.body.message
        : humanizeUpstreamStatus(error.status);
    return {
      status: error.status,
      body: {
        error: message,
        code,
        requestId: error.requestId,
      },
      requestId: error.requestId,
    };
  }

  if (error instanceof OsvaApiError) {
    const requestId =
      error.requestId ??
      (typeof error.body["requestId"] === "string"
        ? error.body["requestId"]
        : undefined);
    return {
      status: error.status,
      body: {
        error: humanizeApiError(error),
        code: error.body.status,
        requestId,
      },
      requestId,
    };
  }

  if (error instanceof OsvaTransportError) {
    return {
      status: 503,
      body: {
        error: "OSVA control plane is unreachable.",
        code: "control_plane_unreachable",
      },
    };
  }

  return {
    status: 500,
    body: {
      error: "Unexpected console server error.",
      code: "internal_error",
    },
  };
}

function humanizeUpstreamStatus(status: number): string {
  if (status === 401) {
    return "Authentication required.";
  }
  if (status === 403) {
    return "Permission denied.";
  }
  if (status === 404) {
    return "Resource not found.";
  }
  if (status === 429) {
    return "Control plane rate limit exceeded. Wait before retrying.";
  }
  if (status === 503) {
    return "Requested resource is unavailable.";
  }
  return `OSVA API error (${status}).`;
}

function humanizeApiError(error: OsvaApiError): string {
  if (error.status === 401) {
    return "Authentication required.";
  }
  if (error.status === 403) {
    return "Permission denied.";
  }
  if (error.status === 404) {
    return "Resource not found.";
  }
  if (error.status === 429) {
    return "Control plane rate limit exceeded. Wait before retrying.";
  }
  if (error.status === 503) {
    return "Requested resource is unavailable.";
  }
  return `OSVA API error (${error.status}).`;
}
