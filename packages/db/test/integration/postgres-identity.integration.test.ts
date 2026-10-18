import type { OrganizationId, UserId, WorkspaceId } from "@osva-ai/contracts";
import {
  COMMUNITY_EDITION_ROLES,
  HUMAN_WORKSPACE_ROLES,
  ORGANIZATION_MEMBERSHIP_ROLES,
} from "@osva-ai/contracts";
import {
  DuplicateOrganizationMembershipError,
  DuplicateUserEmailError,
  DuplicateWorkspaceMembershipError,
  IdentityApplication,
  OrganizationMembership,
  PermissionDeniedError,
  Workspace,
  WorkspaceOwnerInvariantError,
  resolveWorkspaceAccess,
} from "@osva/domain";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createDatabase, type Database } from "../../src/database.js";
import { migrateDatabase } from "../../src/migrate.js";
import {
  PostgresIdentityLifecycleRepository,
  PostgresOrganizationMembershipRepository,
  PostgresUserRepository,
  PostgresWorkspaceMembershipRepository,
} from "../../src/repositories/postgres-identity-repositories.js";
import { PostgresWorkspaceRepository } from "../../src/repositories/postgres-workspace-repository.js";
import { NOW } from "./fixtures.js";
import {
  resetStage0Tables,
  startPostgresForTests,
  stopPostgresForTests,
  type PostgresTestContext,
} from "./postgres-harness.js";

function createIdentityApp(database: Database) {
  const users = new PostgresUserRepository(database);
  const workspaceMemberships = new PostgresWorkspaceMembershipRepository(
    database,
  );
  const workspaces = new PostgresWorkspaceRepository(database);
  const lifecycle = new PostgresIdentityLifecycleRepository(database);
  let counter = 0;

  const identity = new IdentityApplication({
    users,
    workspaceMemberships,
    workspaces,
    lifecycle,
    clock: { now: () => NOW },
    ids: { createId: () => `id-${String(++counter)}` },
  });

  return { identity, users, workspaceMemberships, workspaces };
}

describe("PostgreSQL identity foundation", () => {
  let context: PostgresTestContext;
  let database: Database;

  beforeAll(async () => {
    context = await startPostgresForTests();
    database = createDatabase({
      connectionString: context.connectionString,
      max: 10,
      connectTimeoutSeconds: 10,
    });
    await migrateDatabase(database);
  });

  afterAll(async () => {
    if (database) {
      await database.close();
    }
    if (context) {
      await stopPostgresForTests(context);
    }
  });

  beforeEach(async () => {
    await resetStage0Tables(database);
  });

  it("allows two OWNER memberships in one workspace", async () => {
    const { identity, workspaces } = createIdentityApp(database);
    const workspaceId = "ws-two-owners" as WorkspaceId;
    await workspaces.save(
      Workspace.create({ id: workspaceId, name: "Owners", createdAt: NOW }),
    );

    const owner1 = await identity.registerUser({
      email: "owner1@example.com",
      displayName: "Owner One",
    });
    const owner2 = await identity.registerUser({
      email: "owner2@example.com",
      displayName: "Owner Two",
    });

    await identity.addWorkspaceMembership({
      workspaceId,
      userId: owner1.id,
      role: HUMAN_WORKSPACE_ROLES.OWNER,
    });
    await identity.addWorkspaceMembership({
      workspaceId,
      userId: owner2.id,
      role: HUMAN_WORKSPACE_ROLES.OWNER,
      actorUserId: owner1.id,
    });

    const owners = await database.sql`
      SELECT COUNT(*)::int AS count
      FROM workspace_memberships
      WHERE workspace_id = ${workspaceId} AND role = 'OWNER'
    `;
    expect(owners[0]?.count).toBe(2);
  });

  it("transfers ownership by promoting the target before demoting the source", async () => {
    const { identity, workspaces, workspaceMemberships } =
      createIdentityApp(database);
    const workspaceId = "ws-transfer" as WorkspaceId;
    await workspaces.save(
      Workspace.create({ id: workspaceId, name: "Transfer", createdAt: NOW }),
    );

    const source = await identity.registerUser({
      email: "source@example.com",
      displayName: "Source",
    });
    const target = await identity.registerUser({
      email: "target@example.com",
      displayName: "Target",
    });

    await identity.addWorkspaceMembership({
      workspaceId,
      userId: source.id,
      role: HUMAN_WORKSPACE_ROLES.OWNER,
    });
    await identity.addWorkspaceMembership({
      workspaceId,
      userId: target.id,
      role: HUMAN_WORKSPACE_ROLES.DEVELOPER,
      actorUserId: source.id,
    });

    await identity.transferWorkspaceOwnership({
      workspaceId,
      actorUserId: source.id,
      toUserId: target.id,
      demotedRole: HUMAN_WORKSPACE_ROLES.ADMIN,
    });

    const sourceMembership = await workspaceMemberships.findByWorkspaceAndUser(
      workspaceId,
      source.id,
    );
    const targetMembership = await workspaceMemberships.findByWorkspaceAndUser(
      workspaceId,
      target.id,
    );
    expect(sourceMembership?.role).toBe(HUMAN_WORKSPACE_ROLES.ADMIN);
    expect(targetMembership?.role).toBe(HUMAN_WORKSPACE_ROLES.OWNER);
  });

  it("rejects removing or demoting the last OWNER", async () => {
    const { identity, workspaces, workspaceMemberships } =
      createIdentityApp(database);
    const workspaceId = "ws-last-owner" as WorkspaceId;
    await workspaces.save(
      Workspace.create({ id: workspaceId, name: "Last", createdAt: NOW }),
    );

    const owner = await identity.registerUser({
      email: "solo-owner@example.com",
      displayName: "Solo Owner",
    });
    const membership = await identity.addWorkspaceMembership({
      workspaceId,
      userId: owner.id,
      role: HUMAN_WORKSPACE_ROLES.OWNER,
    });

    await expect(
      identity.removeWorkspaceMembership({
        membershipId: membership.id,
        actorUserId: owner.id,
      }),
    ).rejects.toBeInstanceOf(WorkspaceOwnerInvariantError);

    await expect(
      identity.changeWorkspaceMembershipRole({
        membershipId: membership.id,
        role: HUMAN_WORKSPACE_ROLES.ADMIN,
        actorUserId: owner.id,
      }),
    ).rejects.toBeInstanceOf(WorkspaceOwnerInvariantError);

    const stillOwner = await workspaceMemberships.findById(membership.id);
    expect(stillOwner?.role).toBe(HUMAN_WORKSPACE_ROLES.OWNER);
  });

  it("prevents concurrent owner removals from leaving zero owners", async () => {
    const { identity, workspaces } = createIdentityApp(database);
    const workspaceId = "ws-concurrent" as WorkspaceId;
    await workspaces.save(
      Workspace.create({
        id: workspaceId,
        name: "Concurrent",
        createdAt: NOW,
      }),
    );

    const ownerA = await identity.registerUser({
      email: "own-a@example.com",
      displayName: "Owner A",
    });
    const ownerB = await identity.registerUser({
      email: "own-b@example.com",
      displayName: "Owner B",
    });

    const membershipA = await identity.addWorkspaceMembership({
      workspaceId,
      userId: ownerA.id,
      role: HUMAN_WORKSPACE_ROLES.OWNER,
    });
    const membershipB = await identity.addWorkspaceMembership({
      workspaceId,
      userId: ownerB.id,
      role: HUMAN_WORKSPACE_ROLES.OWNER,
      actorUserId: ownerA.id,
    });

    const results = await Promise.allSettled([
      identity.removeWorkspaceMembership({
        membershipId: membershipA.id,
        actorUserId: ownerA.id,
      }),
      identity.removeWorkspaceMembership({
        membershipId: membershipB.id,
        actorUserId: ownerB.id,
      }),
    ]);

    const fulfilled = results.filter((result) => result.status === "fulfilled");
    const rejected = results.filter((result) => result.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(
      rejected.some(
        (result) =>
          result.status === "rejected" &&
          result.reason instanceof WorkspaceOwnerInvariantError,
      ),
    ).toBe(true);

    const owners = await database.sql`
      SELECT COUNT(*)::int AS count
      FROM workspace_memberships
      WHERE workspace_id = ${workspaceId} AND role = 'OWNER'
    `;
    expect(owners[0]?.count).toBe(1);
  });

  it("prevents concurrent owner demotions from leaving zero owners", async () => {
    const { identity, workspaces, workspaceMemberships } =
      createIdentityApp(database);
    const workspaceId = "ws-concurrent-demote" as WorkspaceId;
    await workspaces.save(
      Workspace.create({
        id: workspaceId,
        name: "Concurrent Demote",
        createdAt: NOW,
      }),
    );

    const ownerA = await identity.registerUser({
      email: "demote-a@example.com",
      displayName: "Demote A",
    });
    const ownerB = await identity.registerUser({
      email: "demote-b@example.com",
      displayName: "Demote B",
    });

    const membershipA = await identity.addWorkspaceMembership({
      workspaceId,
      userId: ownerA.id,
      role: HUMAN_WORKSPACE_ROLES.OWNER,
    });
    const membershipB = await identity.addWorkspaceMembership({
      workspaceId,
      userId: ownerB.id,
      role: HUMAN_WORKSPACE_ROLES.OWNER,
      actorUserId: ownerA.id,
    });

    const results = await Promise.allSettled([
      identity.changeWorkspaceMembershipRole({
        membershipId: membershipA.id,
        role: HUMAN_WORKSPACE_ROLES.ADMIN,
        actorUserId: ownerA.id,
      }),
      identity.changeWorkspaceMembershipRole({
        membershipId: membershipB.id,
        role: HUMAN_WORKSPACE_ROLES.ADMIN,
        actorUserId: ownerB.id,
      }),
    ]);

    const fulfilled = results.filter((result) => result.status === "fulfilled");
    const rejected = results.filter((result) => result.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(
      rejected.some(
        (result) =>
          result.status === "rejected" &&
          result.reason instanceof WorkspaceOwnerInvariantError,
      ),
    ).toBe(true);

    const owners = await database.sql`
      SELECT COUNT(*)::int AS count
      FROM workspace_memberships
      WHERE workspace_id = ${workspaceId} AND role = 'OWNER'
    `;
    expect(owners[0]?.count).toBe(1);

    const stillOwners = await Promise.all([
      workspaceMemberships.findById(membershipA.id),
      workspaceMemberships.findById(membershipB.id),
    ]);
    expect(
      stillOwners.filter((m) => m?.role === HUMAN_WORKSPACE_ROLES.OWNER),
    ).toHaveLength(1);
  });

  it("denies ADMIN from granting OWNER membership", async () => {
    const { identity, workspaces } = createIdentityApp(database);
    const workspaceId = "ws-admin-deny" as WorkspaceId;
    await workspaces.save(
      Workspace.create({ id: workspaceId, name: "Admin Deny", createdAt: NOW }),
    );

    const owner = await identity.registerUser({
      email: "real-owner@example.com",
      displayName: "Real Owner",
    });
    const admin = await identity.registerUser({
      email: "admin@example.com",
      displayName: "Admin",
    });
    const candidate = await identity.registerUser({
      email: "candidate@example.com",
      displayName: "Candidate",
    });

    await identity.addWorkspaceMembership({
      workspaceId,
      userId: owner.id,
      role: HUMAN_WORKSPACE_ROLES.OWNER,
    });
    await identity.addWorkspaceMembership({
      workspaceId,
      userId: admin.id,
      role: HUMAN_WORKSPACE_ROLES.ADMIN,
      actorUserId: owner.id,
    });

    await expect(
      identity.addWorkspaceMembership({
        workspaceId,
        userId: candidate.id,
        role: HUMAN_WORKSPACE_ROLES.OWNER,
        actorUserId: admin.id,
      }),
    ).rejects.toBeInstanceOf(PermissionDeniedError);
  });

  it("denies ADMIN from demoting or removing an OWNER", async () => {
    const { identity, workspaces, workspaceMemberships } =
      createIdentityApp(database);
    const workspaceId = "ws-admin-owner-mgmt" as WorkspaceId;
    await workspaces.save(
      Workspace.create({
        id: workspaceId,
        name: "Admin Owner Mgmt",
        createdAt: NOW,
      }),
    );

    const owner = await identity.registerUser({
      email: "owner-mgmt@example.com",
      displayName: "Owner",
    });
    const admin = await identity.registerUser({
      email: "admin-mgmt@example.com",
      displayName: "Admin",
    });
    const otherOwner = await identity.registerUser({
      email: "other-owner@example.com",
      displayName: "Other Owner",
    });

    await identity.addWorkspaceMembership({
      workspaceId,
      userId: owner.id,
      role: HUMAN_WORKSPACE_ROLES.OWNER,
    });
    await identity.addWorkspaceMembership({
      workspaceId,
      userId: otherOwner.id,
      role: HUMAN_WORKSPACE_ROLES.OWNER,
      actorUserId: owner.id,
    });
    const adminMembership = await identity.addWorkspaceMembership({
      workspaceId,
      userId: admin.id,
      role: HUMAN_WORKSPACE_ROLES.ADMIN,
      actorUserId: owner.id,
    });
    const otherOwnerMembership =
      await workspaceMemberships.findByWorkspaceAndUser(
        workspaceId,
        otherOwner.id,
      );
    if (otherOwnerMembership === null) {
      throw new Error("expected other owner membership");
    }

    await expect(
      identity.changeWorkspaceMembershipRole({
        membershipId: otherOwnerMembership.id,
        role: HUMAN_WORKSPACE_ROLES.ADMIN,
        actorUserId: admin.id,
      }),
    ).rejects.toBeInstanceOf(PermissionDeniedError);

    await expect(
      identity.removeWorkspaceMembership({
        membershipId: otherOwnerMembership.id,
        actorUserId: admin.id,
      }),
    ).rejects.toBeInstanceOf(PermissionDeniedError);

    expect(adminMembership.role).toBe(HUMAN_WORKSPACE_ROLES.ADMIN);
  });

  it("allows two OWNER organization memberships in one organization", async () => {
    const { identity } = createIdentityApp(database);
    const orgMemberships = new PostgresOrganizationMembershipRepository(
      database,
    );

    const owner1 = await identity.registerUser({
      email: "org-owner1@example.com",
      displayName: "Org Owner One",
    });
    const owner2 = await identity.registerUser({
      email: "org-owner2@example.com",
      displayName: "Org Owner Two",
    });
    const organization = await identity.createOrganization({
      name: "Multi Owner Org",
      ownerUserId: owner1.id,
    });

    await orgMemberships.save(
      OrganizationMembership.create({
        id: "org-owner-2" as never,
        organizationId: organization.id as OrganizationId,
        userId: owner2.id as UserId,
        role: ORGANIZATION_MEMBERSHIP_ROLES.OWNER,
        createdAt: NOW,
      }),
    );

    const owners = await database.sql`
      SELECT COUNT(*)::int AS count
      FROM organization_memberships
      WHERE organization_id = ${organization.id}
        AND role = 'OWNER'
    `;
    expect(owners[0]?.count).toBe(2);
  });

  it("does not grant workspace access from organization membership alone", async () => {
    const { identity, users, workspaceMemberships, workspaces } =
      createIdentityApp(database);
    const workspaceId = "ws-org-only" as WorkspaceId;
    await workspaces.save(
      Workspace.create({ id: workspaceId, name: "Org Only", createdAt: NOW }),
    );

    const user = await identity.registerUser({
      email: "org-member@example.com",
      displayName: "Org Member",
    });
    await identity.createOrganization({
      name: "Org",
      ownerUserId: user.id,
    });

    const resolved = await resolveWorkspaceAccess(
      { users, workspaceMemberships },
      { userId: user.id as UserId, workspaceId },
    );
    expect(resolved).toBeUndefined();
  });

  it("does not resolve workspace access for DISABLED users", async () => {
    const { identity, users, workspaceMemberships, workspaces } =
      createIdentityApp(database);
    const workspaceId = "ws-disabled" as WorkspaceId;
    await workspaces.save(
      Workspace.create({ id: workspaceId, name: "Disabled", createdAt: NOW }),
    );

    const user = await identity.registerUser({
      email: "disabled@example.com",
      displayName: "Disabled User",
    });
    await identity.addWorkspaceMembership({
      workspaceId,
      userId: user.id,
      role: HUMAN_WORKSPACE_ROLES.VIEWER,
    });

    await database.sql`
      UPDATE users SET status = 'DISABLED' WHERE id = ${user.id}
    `;

    const resolved = await resolveWorkspaceAccess(
      { users, workspaceMemberships },
      { userId: user.id as UserId, workspaceId },
    );
    expect(resolved).toBeUndefined();
  });

  it("rejects duplicate user emails and duplicate memberships", async () => {
    const { identity, workspaces } = createIdentityApp(database);
    const workspaceId = "ws-dup" as WorkspaceId;
    await workspaces.save(
      Workspace.create({ id: workspaceId, name: "Dup", createdAt: NOW }),
    );

    const user = await identity.registerUser({
      email: "dup@example.com",
      displayName: "Dup",
    });

    await expect(
      identity.registerUser({
        email: "dup@example.com",
        displayName: "Dup Two",
      }),
    ).rejects.toBeInstanceOf(DuplicateUserEmailError);

    await identity.addWorkspaceMembership({
      workspaceId,
      userId: user.id,
      role: HUMAN_WORKSPACE_ROLES.VIEWER,
    });
    await expect(
      identity.addWorkspaceMembership({
        workspaceId,
        userId: user.id,
        role: HUMAN_WORKSPACE_ROLES.OPERATOR,
      }),
    ).rejects.toBeInstanceOf(DuplicateWorkspaceMembershipError);

    const organization = await identity.createOrganization({
      name: "Dup Org",
      ownerUserId: user.id,
    });
    const orgMemberships = new PostgresOrganizationMembershipRepository(
      database,
    );
    await expect(
      orgMemberships.save(
        OrganizationMembership.create({
          id: "dup-org-membership" as never,
          organizationId: organization.id as OrganizationId,
          userId: user.id as UserId,
          role: ORGANIZATION_MEMBERSHIP_ROLES.MEMBER,
          createdAt: NOW,
        }),
      ),
    ).rejects.toBeInstanceOf(DuplicateOrganizationMembershipError);
  });
});

describe("PostgreSQL identity migration compatibility", () => {
  let context: PostgresTestContext;

  beforeAll(async () => {
    context = await startPostgresForTests();
  }, 180_000);

  afterAll(async () => {
    await stopPostgresForTests(context);
  });

  it("preserves api_keys rows across the 0023 to 0024 upgrade", async () => {
    const stage23Dir = await materializeMigrationsThroughTag(
      context,
      "0023_execution_lease_slice",
    );

    const database = createDatabase({
      connectionString: context.connectionString,
      max: 1,
    });

    await database.sql`DROP SCHEMA IF EXISTS drizzle CASCADE`;
    await database.sql`DROP SCHEMA public CASCADE`;
    await database.sql`CREATE SCHEMA public`;

    await migrateDatabase(database, { migrationsFolder: stage23Dir });

    const workspaceId = "ws-api-upgrade" as WorkspaceId;
    await database.sql`
      INSERT INTO workspaces (id, name, created_at)
      VALUES (${workspaceId}, ${"API Upgrade"}, ${"2026-01-01T00:00:00.000Z"})
    `;

    const digest = Buffer.from("a".repeat(32));
    await database.sql`
      INSERT INTO api_keys (
        id, workspace_id, name, role, secret_digest, created_at, expires_at, revoked_at
      ) VALUES (
        ${"ak-upgrade"},
        ${workspaceId},
        ${"upgrade-key"},
        ${COMMUNITY_EDITION_ROLES.ADMIN},
        ${digest},
        ${"2026-01-02T00:00:00.000Z"},
        ${"2026-12-31T00:00:00.000Z"},
        ${null}
      )
    `;

    const before = await database.sql`
      SELECT id, workspace_id, name, role, secret_digest, created_at, expires_at, revoked_at
      FROM api_keys WHERE id = ${"ak-upgrade"}
    `;

    await migrateDatabase(database);

    const after = await database.sql`
      SELECT id, workspace_id, name, role, secret_digest, created_at, expires_at, revoked_at
      FROM api_keys WHERE id = ${"ak-upgrade"}
    `;

    expect(after[0]).toEqual(before[0]);

    await database.close();
  });
});

async function materializeMigrationsThroughTag(
  context: PostgresTestContext,
  tag: string,
): Promise<string> {
  const fs = await import("node:fs");
  const os = await import("node:os");
  const path = await import("node:path");
  const { drizzleDirectory } = await import("../../src/index.js");
  const { readDrizzleJournal } = await import("../../src/migration-history.js");

  const targetDir = fs.mkdtempSync(path.join(os.tmpdir(), "osva-mig-partial-"));
  const sourceDir = drizzleDirectory();
  const journal = readDrizzleJournal(sourceDir);
  const entry = journal.entries.find((item) => item.tag === tag);
  if (entry === undefined) {
    throw new Error(`Migration tag not found: ${tag}`);
  }
  const filtered = journal.entries.filter((item) => item.idx <= entry.idx);
  fs.mkdirSync(path.join(targetDir, "meta"), { recursive: true });
  fs.writeFileSync(
    path.join(targetDir, "meta", "_journal.json"),
    `${JSON.stringify({ ...journal, entries: filtered }, null, 2)}\n`,
    "utf8",
  );
  for (const item of filtered) {
    fs.copyFileSync(
      path.join(sourceDir, `${item.tag}.sql`),
      path.join(targetDir, `${item.tag}.sql`),
    );
  }
  return targetDir;
}
