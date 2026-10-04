import type { ServerResponse } from "node:http";

import { OsvaApiError, OsvaTransportError } from "@osva-ai/sdk";

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

function humanizeApiError(error: OsvaApiError): string {
  if (error.status === 401) {
    return "Authentication required. Check OSVA_CONSOLE_API_KEY.";
  }
  if (error.status === 403) {
    return "Permission denied for this workspace API key.";
  }
  if (error.status === 404) {
    return "Resource not found.";
  }
  return `OSVA API error (${error.status}).`;
}
