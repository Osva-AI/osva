import type { OrganizationId, WorkspaceId } from "@osva-ai/contracts";
import {
  HUMAN_WORKSPACE_ROLES,
  ORGANIZATION_MEMBERSHIP_ROLES,
} from "@osva-ai/contracts";
import { WorkspaceOwnerInvariantError } from "@osva/domain";
import { and, count, eq, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import type { DatabaseSchema } from "../database.js";
import { organizationMemberships } from "../schema/organization-memberships.js";
import { workspaceMemberships } from "../schema/workspace-memberships.js";

type Tx = PostgresJsDatabase<DatabaseSchema>;

export async function lockWorkspaceOwnerScope(
  tx: Tx,
  workspaceId: WorkspaceId,
): Promise<void> {
  await tx.execute(
    sql`SELECT id FROM workspaces WHERE id = ${workspaceId} FOR UPDATE`,
  );
  await tx.execute(sql`
    SELECT id
    FROM workspace_memberships
    WHERE workspace_id = ${workspaceId}
      AND role = ${HUMAN_WORKSPACE_ROLES.OWNER}
    FOR UPDATE
  `);
}

export async function countWorkspaceOwners(
  tx: Tx,
  workspaceId: WorkspaceId,
): Promise<number> {
  const [row] = await tx
    .select({ value: count() })
    .from(workspaceMemberships)
    .where(
      and(
        eq(workspaceMemberships.workspaceId, workspaceId),
        eq(workspaceMemberships.role, HUMAN_WORKSPACE_ROLES.OWNER),
      ),
    );
  return Number(row?.value ?? 0);
}

export function assertWorkspaceOwnerCountAfterChange(
  ownerCount: number,
  hadOwnersBefore: boolean,
): void {
  if (hadOwnersBefore && ownerCount < 1) {
    throw new WorkspaceOwnerInvariantError(
      "Workspace must retain at least one OWNER.",
    );
  }
}

export async function lockOrganizationOwnerScope(
  tx: Tx,
  organizationId: OrganizationId,
): Promise<void> {
  await tx.execute(
    sql`SELECT id FROM organizations WHERE id = ${organizationId} FOR UPDATE`,
  );
  await tx.execute(sql`
    SELECT id
    FROM organization_memberships
    WHERE organization_id = ${organizationId}
      AND role = ${ORGANIZATION_MEMBERSHIP_ROLES.OWNER}
    FOR UPDATE
  `);
}

export async function countOrganizationOwners(
  tx: Tx,
  organizationId: OrganizationId,
): Promise<number> {
  const [row] = await tx
    .select({ value: count() })
    .from(organizationMemberships)
    .where(
      and(
        eq(organizationMemberships.organizationId, organizationId),
        eq(organizationMemberships.role, ORGANIZATION_MEMBERSHIP_ROLES.OWNER),
      ),
    );
  return Number(row?.value ?? 0);
}

export function assertOrganizationOwnerCountAfterChange(
  ownerCount: number,
  hadOwnersBefore: boolean,
): void {
  if (hadOwnersBefore && ownerCount < 1) {
    throw new WorkspaceOwnerInvariantError(
      "Organization must retain at least one OWNER.",
    );
  }
}
