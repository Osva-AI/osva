import { count, eq, isNull } from "drizzle-orm";

import { USER_STATUSES } from "@osva-ai/contracts";
import type { WorkspaceId } from "@osva-ai/contracts";

import { createDatabase } from "./database.js";
import { apiKeys } from "./schema/api-keys.js";
import { organizations } from "./schema/organizations.js";
import { users } from "./schema/users.js";
import { workspaces } from "./schema/workspaces.js";

export interface InstallationStatusSnapshot {
  readonly schemaVersion: 1;
  readonly workspaceCount: number;
  readonly apiKeyCount: number;
  readonly organizationCount: number;
  readonly humanUserCount: number;
  readonly pendingSetupUserCount: number;
  readonly unlinkedWorkspaceIds: readonly WorkspaceId[];
}

export async function readInstallationStatusSnapshot(
  connectionString: string,
): Promise<InstallationStatusSnapshot> {
  const database = createDatabase({
    connectionString,
    max: 1,
  });
  try {
    const [workspaceRow] = await database.db
      .select({ value: count() })
      .from(workspaces);
    const [apiKeyRow] = await database.db
      .select({ value: count() })
      .from(apiKeys);
    const [organizationRow] = await database.db
      .select({ value: count() })
      .from(organizations);
    const [humanUserRow] = await database.db
      .select({ value: count() })
      .from(users);
    const [pendingSetupRow] = await database.db
      .select({ value: count() })
      .from(users)
      .where(eq(users.status, USER_STATUSES.PENDING_SETUP));
    const unlinkedRows = await database.db
      .select({ id: workspaces.id })
      .from(workspaces)
      .where(isNull(workspaces.organizationId))
      .orderBy(workspaces.id);

    return {
      schemaVersion: 1,
      workspaceCount: Number(workspaceRow?.value ?? 0),
      apiKeyCount: Number(apiKeyRow?.value ?? 0),
      organizationCount: Number(organizationRow?.value ?? 0),
      humanUserCount: Number(humanUserRow?.value ?? 0),
      pendingSetupUserCount: Number(pendingSetupRow?.value ?? 0),
      unlinkedWorkspaceIds: unlinkedRows.map((row) => row.id as WorkspaceId),
    };
  } finally {
    await database.close();
  }
}

const connectionString = process.env.OSVA_DATABASE_URL?.trim();

if (connectionString === undefined || connectionString.length === 0) {
  console.error("OSVA_DATABASE_URL is required.");
  process.exitCode = 1;
} else {
  readInstallationStatusSnapshot(connectionString)
    .then((snapshot) => {
      process.stdout.write(`${JSON.stringify(snapshot)}\n`);
    })
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    });
}
