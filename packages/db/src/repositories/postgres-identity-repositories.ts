import type {
  OrganizationId,
  OrganizationMembershipId,
  UserId,
  WorkspaceId,
  WorkspaceMembershipId,
} from "@osva-ai/contracts";
import type { HumanWorkspaceRole } from "@osva-ai/contracts";
import { HUMAN_WORKSPACE_ROLES } from "@osva-ai/contracts";
import {
  DuplicateOrganizationMembershipError,
  DuplicateUserEmailError,
  DuplicateWorkspaceMembershipError,
  type CreateOrganizationWithOwnerInput,
  type AssignWorkspaceOwnerMembershipInput,
  type CreateWorkspaceMembershipInput,
  type ChangeWorkspaceMembershipRoleInput,
  type IdentityLifecycleRepository,
  type OrganizationMembershipRepository,
  type OrganizationRepository,
  type RegisterUserInput,
  type RemoveWorkspaceMembershipInput,
  type SecurityAuditEventRepository,
  type TransferWorkspaceOwnershipInput,
  type UserRepository,
  type WorkspaceMembershipRepository,
  WorkspaceOwnerInvariantError,
} from "@osva/domain";
import { and, count, eq, sql } from "drizzle-orm";

import type { Database } from "../database.js";
import {
  organizationFromRow,
  organizationMembershipFromRow,
  organizationMembershipToRow,
  organizationToRow,
  securityAuditEventFromRow,
  securityAuditEventToRow,
  userFromRow,
  userToRow,
  workspaceMembershipFromRow,
  workspaceMembershipToRow,
} from "../mappers/identity-mapper.js";
import {
  assertWorkspaceOwnerCountAfterChange,
  countWorkspaceOwners,
  lockWorkspaceOwnerScope,
} from "./identity-owner-scope.js";
import {
  mapDatabaseError,
  postgresErrorCode,
  POSTGRES_UNIQUE_VIOLATION,
  withMappedDatabaseErrors,
} from "../postgres-errors.js";
import { organizationMemberships } from "../schema/organization-memberships.js";
import { organizations } from "../schema/organizations.js";
import { securityAuditEvents } from "../schema/security-audit-events.js";
import { users } from "../schema/users.js";
import { workspaceMemberships } from "../schema/workspace-memberships.js";

function mapIdentityUniqueViolation(error: unknown): never {
  if (postgresErrorCode(error) !== POSTGRES_UNIQUE_VIOLATION) {
    throw mapDatabaseError(error);
  }

  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("users_email_lower_unique")) {
    throw new DuplicateUserEmailError("duplicate");
  }
  if (message.includes("organization_memberships_org_user_unique")) {
    throw new DuplicateOrganizationMembershipError(
      "org" as OrganizationId,
      "user" as UserId,
    );
  }
  if (message.includes("workspace_memberships_workspace_user_unique")) {
    throw new DuplicateWorkspaceMembershipError(
      "ws" as WorkspaceId,
      "user" as UserId,
    );
  }

  throw mapDatabaseError(error);
}

export class PostgresOrganizationRepository implements OrganizationRepository {
  constructor(private readonly database: Database) {}

  async save(organization: Parameters<OrganizationRepository["save"]>[0]) {
    const row = organizationToRow(organization);
    await withMappedDatabaseErrors(() =>
      this.database.db
        .insert(organizations)
        .values(row)
        .onConflictDoUpdate({
          target: organizations.id,
          set: { name: row.name, createdAt: row.createdAt },
        }),
    );
  }

  async findById(id: OrganizationId) {
    const [row] = await this.database.db
      .select()
      .from(organizations)
      .where(eq(organizations.id, id))
      .limit(1);
    return row === undefined ? null : organizationFromRow(row);
  }
}

export class PostgresUserRepository implements UserRepository {
  constructor(private readonly database: Database) {}

  async save(user: Parameters<UserRepository["save"]>[0]) {
    const row = userToRow(user);
    try {
      await this.database.db
        .insert(users)
        .values(row)
        .onConflictDoUpdate({
          target: users.id,
          set: {
            email: row.email,
            displayName: row.displayName,
            status: row.status,
            createdAt: row.createdAt,
          },
        });
    } catch (error) {
      if (postgresErrorCode(error) === POSTGRES_UNIQUE_VIOLATION) {
        throw new DuplicateUserEmailError(user.email);
      }
      throw mapIdentityUniqueViolation(error);
    }
  }

  async findById(id: UserId) {
    const [row] = await this.database.db
      .select()
      .from(users)
      .where(eq(users.id, id))
      .limit(1);
    return row === undefined ? null : userFromRow(row);
  }

  async findByEmail(email: string) {
    const [row] = await this.database.db
      .select()
      .from(users)
      .where(sql`lower(${users.email}) = lower(${email})`)
      .limit(1);
    return row === undefined ? null : userFromRow(row);
  }
}

export class PostgresOrganizationMembershipRepository implements OrganizationMembershipRepository {
  constructor(private readonly database: Database) {}

  async save(
    membership: Parameters<OrganizationMembershipRepository["save"]>[0],
  ) {
    const row = organizationMembershipToRow(membership);
    try {
      await this.database.db.insert(organizationMemberships).values(row);
    } catch (error) {
      if (postgresErrorCode(error) === POSTGRES_UNIQUE_VIOLATION) {
        throw new DuplicateOrganizationMembershipError(
          membership.organizationId,
          membership.userId,
        );
      }
      throw mapIdentityUniqueViolation(error);
    }
  }

  async findById(id: OrganizationMembershipId) {
    const [row] = await this.database.db
      .select()
      .from(organizationMemberships)
      .where(eq(organizationMemberships.id, id))
      .limit(1);
    return row === undefined ? null : organizationMembershipFromRow(row);
  }

  async findByOrganizationAndUser(
    organizationId: OrganizationId,
    userId: UserId,
  ) {
    const [row] = await this.database.db
      .select()
      .from(organizationMemberships)
      .where(
        and(
          eq(organizationMemberships.organizationId, organizationId),
          eq(organizationMemberships.userId, userId),
        ),
      )
      .limit(1);
    return row === undefined ? null : organizationMembershipFromRow(row);
  }
}

export class PostgresWorkspaceMembershipRepository implements WorkspaceMembershipRepository {
  constructor(private readonly database: Database) {}

  async save(membership: Parameters<WorkspaceMembershipRepository["save"]>[0]) {
    const row = workspaceMembershipToRow(membership);
    try {
      await this.database.db.insert(workspaceMemberships).values(row);
    } catch (error) {
      throw mapIdentityUniqueViolation(error);
    }
  }

  async findById(id: WorkspaceMembershipId) {
    const [row] = await this.database.db
      .select()
      .from(workspaceMemberships)
      .where(eq(workspaceMemberships.id, id))
      .limit(1);
    return row === undefined ? null : workspaceMembershipFromRow(row);
  }

  async findByWorkspaceAndUser(workspaceId: WorkspaceId, userId: UserId) {
    const [row] = await this.database.db
      .select()
      .from(workspaceMemberships)
      .where(
        and(
          eq(workspaceMemberships.workspaceId, workspaceId),
          eq(workspaceMemberships.userId, userId),
        ),
      )
      .limit(1);
    return row === undefined ? null : workspaceMembershipFromRow(row);
  }

  async countByWorkspaceAndRole(
    workspaceId: WorkspaceId,
    role: HumanWorkspaceRole,
  ) {
    const [row] = await this.database.db
      .select({ value: count() })
      .from(workspaceMemberships)
      .where(
        and(
          eq(workspaceMemberships.workspaceId, workspaceId),
          eq(workspaceMemberships.role, role),
        ),
      );
    return Number(row?.value ?? 0);
  }

  async deleteById(id: WorkspaceMembershipId) {
    await this.database.db
      .delete(workspaceMemberships)
      .where(eq(workspaceMemberships.id, id));
  }

  async listByUserId(userId: UserId) {
    const rows = await this.database.db
      .select()
      .from(workspaceMemberships)
      .where(eq(workspaceMemberships.userId, userId));
    return rows.map((row) => workspaceMembershipFromRow(row));
  }

  async listByWorkspaceId(workspaceId: WorkspaceId) {
    const rows = await this.database.db
      .select()
      .from(workspaceMemberships)
      .where(eq(workspaceMemberships.workspaceId, workspaceId));
    return rows.map((row) => workspaceMembershipFromRow(row));
  }
}

export class PostgresSecurityAuditEventRepository implements SecurityAuditEventRepository {
  constructor(private readonly database: Database) {}

  async append(event: Parameters<SecurityAuditEventRepository["append"]>[0]) {
    const row = securityAuditEventToRow(event);
    await withMappedDatabaseErrors(() =>
      this.database.db.insert(securityAuditEvents).values(row),
    );
  }

  async listForWorkspace(workspaceId: WorkspaceId, limit: number) {
    const rows = await this.database.db
      .select()
      .from(securityAuditEvents)
      .where(eq(securityAuditEvents.workspaceId, workspaceId))
      .orderBy(sql`${securityAuditEvents.occurredAt} desc`)
      .limit(limit);
    return rows.map((row) => securityAuditEventFromRow(row));
  }
}

export class PostgresIdentityLifecycleRepository implements IdentityLifecycleRepository {
  constructor(private readonly database: Database) {}

  async registerUser(input: RegisterUserInput): Promise<void> {
    await this.database.db.transaction(async (tx) => {
      const userRow = userToRow(input.user);
      const auditRow = securityAuditEventToRow(input.auditEvent);
      try {
        await tx.insert(users).values(userRow);
        await tx.insert(securityAuditEvents).values(auditRow);
      } catch (error) {
        if (postgresErrorCode(error) === POSTGRES_UNIQUE_VIOLATION) {
          throw new DuplicateUserEmailError(input.user.email);
        }
        throw mapIdentityUniqueViolation(error);
      }
    });
  }

  async createOrganizationWithOwner(
    input: CreateOrganizationWithOwnerInput,
  ): Promise<void> {
    await this.database.db.transaction(async (tx) => {
      try {
        await tx
          .insert(organizations)
          .values(organizationToRow(input.organization));
        await tx
          .insert(organizationMemberships)
          .values(organizationMembershipToRow(input.ownerMembership));
        await tx
          .insert(securityAuditEvents)
          .values(securityAuditEventToRow(input.auditEvent));
      } catch (error) {
        throw mapIdentityUniqueViolation(error);
      }
    });
  }

  async createWorkspaceMembership(
    input: CreateWorkspaceMembershipInput,
  ): Promise<void> {
    await this.database.db.transaction(async (tx) => {
      try {
        await tx
          .insert(workspaceMemberships)
          .values(workspaceMembershipToRow(input.membership));
        await tx
          .insert(securityAuditEvents)
          .values(securityAuditEventToRow(input.auditEvent));
      } catch (error) {
        if (postgresErrorCode(error) === POSTGRES_UNIQUE_VIOLATION) {
          throw new DuplicateWorkspaceMembershipError(
            input.membership.workspaceId,
            input.membership.userId,
          );
        }
        throw mapIdentityUniqueViolation(error);
      }
    });
  }

  async assignWorkspaceOwnerMembership(
    input: AssignWorkspaceOwnerMembershipInput,
  ): Promise<void> {
    await this.database.db.transaction(async (tx) => {
      await lockWorkspaceOwnerScope(tx, input.workspaceId);
      const ownersBefore = await countWorkspaceOwners(tx, input.workspaceId);
      try {
        await tx
          .insert(workspaceMemberships)
          .values(workspaceMembershipToRow(input.membership));
        await tx
          .insert(securityAuditEvents)
          .values(securityAuditEventToRow(input.auditEvent));
      } catch (error) {
        if (postgresErrorCode(error) === POSTGRES_UNIQUE_VIOLATION) {
          throw new DuplicateWorkspaceMembershipError(
            input.membership.workspaceId,
            input.membership.userId,
          );
        }
        throw mapIdentityUniqueViolation(error);
      }
      const ownersAfter = await countWorkspaceOwners(tx, input.workspaceId);
      assertWorkspaceOwnerCountAfterChange(ownersAfter, ownersBefore > 0);
    });
  }

  async transferWorkspaceOwnership(
    input: TransferWorkspaceOwnershipInput,
  ): Promise<void> {
    await this.database.db.transaction(async (tx) => {
      await lockWorkspaceOwnerScope(tx, input.workspaceId);
      const ownersBefore = await countWorkspaceOwners(tx, input.workspaceId);
      if (ownersBefore < 1) {
        throw new WorkspaceOwnerInvariantError(
          "Workspace ownership transfer requires an existing OWNER.",
        );
      }

      await tx
        .update(workspaceMemberships)
        .set({ role: HUMAN_WORKSPACE_ROLES.OWNER })
        .where(eq(workspaceMemberships.id, input.toMembershipId));
      await tx
        .update(workspaceMemberships)
        .set({ role: input.demotedRole })
        .where(eq(workspaceMemberships.id, input.fromMembershipId));
      await tx
        .insert(securityAuditEvents)
        .values(securityAuditEventToRow(input.auditEvent));

      const ownersAfter = await countWorkspaceOwners(tx, input.workspaceId);
      assertWorkspaceOwnerCountAfterChange(ownersAfter, true);
    });
  }

  async changeWorkspaceMembershipRole(
    input: ChangeWorkspaceMembershipRoleInput,
  ): Promise<void> {
    await this.database.db.transaction(async (tx) => {
      const touchesOwner =
        input.previousRole === HUMAN_WORKSPACE_ROLES.OWNER ||
        input.membership.role === HUMAN_WORKSPACE_ROLES.OWNER;

      if (touchesOwner) {
        await lockWorkspaceOwnerScope(tx, input.workspaceId);
        const ownersBefore = await countWorkspaceOwners(tx, input.workspaceId);
        if (
          input.previousRole === HUMAN_WORKSPACE_ROLES.OWNER &&
          input.membership.role !== HUMAN_WORKSPACE_ROLES.OWNER &&
          ownersBefore <= 1
        ) {
          throw new WorkspaceOwnerInvariantError(
            "Cannot demote the last workspace OWNER.",
          );
        }

        const row = workspaceMembershipToRow(input.membership);
        await tx
          .update(workspaceMemberships)
          .set({ role: row.role })
          .where(eq(workspaceMemberships.id, row.id));
        await tx
          .insert(securityAuditEvents)
          .values(securityAuditEventToRow(input.auditEvent));

        const ownersAfter = await countWorkspaceOwners(tx, input.workspaceId);
        assertWorkspaceOwnerCountAfterChange(ownersAfter, ownersBefore > 0);
        return;
      }

      const row = workspaceMembershipToRow(input.membership);
      await tx
        .update(workspaceMemberships)
        .set({ role: row.role })
        .where(eq(workspaceMemberships.id, row.id));
      await tx
        .insert(securityAuditEvents)
        .values(securityAuditEventToRow(input.auditEvent));
    });
  }

  async removeWorkspaceMembership(
    input: RemoveWorkspaceMembershipInput,
  ): Promise<void> {
    await this.database.db.transaction(async (tx) => {
      if (input.membershipRole === HUMAN_WORKSPACE_ROLES.OWNER) {
        await lockWorkspaceOwnerScope(tx, input.workspaceId);
        const ownersBefore = await countWorkspaceOwners(tx, input.workspaceId);
        if (ownersBefore <= 1) {
          throw new WorkspaceOwnerInvariantError(
            "Cannot remove the last workspace OWNER.",
          );
        }
      }

      await tx
        .delete(workspaceMemberships)
        .where(eq(workspaceMemberships.id, input.membershipId));

      if (input.membershipRole === HUMAN_WORKSPACE_ROLES.OWNER) {
        const ownersAfter = await countWorkspaceOwners(tx, input.workspaceId);
        assertWorkspaceOwnerCountAfterChange(ownersAfter, true);
      }

      await tx
        .insert(securityAuditEvents)
        .values(securityAuditEventToRow(input.auditEvent));
    });
  }
}
