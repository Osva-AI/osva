import { randomUUID } from "node:crypto";

import type { WorkspaceId } from "@osva/contracts";
import type { Database } from "@osva/db";
import {
  PostgresApiKeyRepository,
  PostgresWorkspaceRepository,
} from "@osva/db";
import { Workspace, createApiKeyApplication } from "@osva/domain";

export const integrationAuth = {
  token: "",
};

export async function bootstrapIntegrationAuth(
  database: Database,
  workspaceId: WorkspaceId,
  now: Date,
  workspaceName = "Workspace",
): Promise<void> {
  const workspaces = new PostgresWorkspaceRepository(database);
  await workspaces.save(
    Workspace.create({
      id: workspaceId,
      name: workspaceName,
      createdAt: now,
    }),
  );
  const apiKeys = new PostgresApiKeyRepository(database);
  const apiKeyApplication = createApiKeyApplication({
    apiKeys,
    workspaces,
    clock: { now: () => now },
    ids: { createId: () => randomUUID() },
  });
  const boot = await apiKeyApplication.bootstrapInstallation.execute({
    workspaceId,
  });
  integrationAuth.token = boot.plaintextToken;
}

export function integrationAuthHeaders(
  extra: Record<string, string> = {},
): Record<string, string> {
  const headers = { ...extra };
  if (integrationAuth.token.length > 0) {
    headers.authorization = `Bearer ${integrationAuth.token}`;
  }
  return headers;
}

function requestHeaders(body?: unknown): Record<string, string> | undefined {
  const headers: Record<string, string> = {};
  if (body !== undefined) {
    headers["content-type"] = "application/json";
  }
  if (integrationAuth.token.length > 0) {
    headers.authorization = `Bearer ${integrationAuth.token}`;
  }
  return Object.keys(headers).length > 0 ? headers : undefined;
}

export async function fetchJson(
  url: string,
  init: { method?: string; body?: unknown } = {},
): Promise<{ status: number; body: unknown }> {
  const response = await fetch(url, {
    method: init.method ?? "GET",
    headers: requestHeaders(init.body),
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  return { status: response.status, body: await response.json() };
}

export async function postJson(
  url: string,
  body: unknown,
): Promise<{ status: number; body: unknown }> {
  return fetchJson(url, { method: "POST", body });
}

export async function getJson(
  url: string,
): Promise<{ status: number; body: unknown }> {
  return fetchJson(url);
}
