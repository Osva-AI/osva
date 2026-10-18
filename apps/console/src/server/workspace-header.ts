import type { IncomingMessage } from "node:http";

import { OSVA_WORKSPACE_ID_HEADER } from "@osva-ai/contracts";

export function readBrowserWorkspaceId(
  request: IncomingMessage,
): string | undefined {
  const raw = headerValue(
    request.headers[OSVA_WORKSPACE_ID_HEADER.toLowerCase()],
  );
  if (raw === undefined) {
    return undefined;
  }
  return isValidWorkspaceId(raw) ? raw : undefined;
}

export function readBrowserWorkspaceIdOrReject(
  request: IncomingMessage,
): { readonly workspaceId: string } | { readonly invalid: true } {
  const raw = headerValue(
    request.headers[OSVA_WORKSPACE_ID_HEADER.toLowerCase()],
  );
  if (raw === undefined) {
    return { invalid: true };
  }
  if (!isValidWorkspaceId(raw)) {
    return { invalid: true };
  }
  return { workspaceId: raw };
}

function isValidWorkspaceId(value: string): boolean {
  return value.trim().length > 0;
}

function headerValue(
  value: string | readonly string[] | undefined,
): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const raw = typeof value === "string" ? value : value[0];
  const trimmed = raw?.trim() ?? "";
  return trimmed.length === 0 ? undefined : trimmed;
}
