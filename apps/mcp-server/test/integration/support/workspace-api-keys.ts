import { randomUUID } from "node:crypto";

import type { WorkspaceId } from "@osva/contracts";
import { COMMUNITY_EDITION_ROLES } from "@osva/contracts";
import type { Database } from "@osva/db";
import {
  PostgresApiKeyRepository,
  PostgresWorkspaceRepository,
} from "@osva/db";
import { createApiKeyApplication } from "@osva/domain";

export async function seedWorkspaceAdminApiKeys(
  database: Database,
  workspaces: readonly { readonly id: WorkspaceId; readonly name: string }[],
): Promise<Record<WorkspaceId, string>> {
  const application = createApiKeyApplication({
    apiKeys: new PostgresApiKeyRepository(database),
    workspaces: new PostgresWorkspaceRepository(database),
    clock: { now: () => new Date("2026-01-15T12:00:00.000Z") },
    ids: { createId: () => randomUUID() },
  });

  const tokens: Partial<Record<WorkspaceId, string>> = {};
  for (const workspace of workspaces) {
    const created = await application.createApiKey.execute({
      workspaceId: workspace.id,
      name: `mcp-${workspace.name}`,
      role: COMMUNITY_EDITION_ROLES.ADMIN,
    });
    tokens[workspace.id] = created.plaintextToken;
  }

  return tokens as Record<WorkspaceId, string>;
}

export function authorizationHeader(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}
