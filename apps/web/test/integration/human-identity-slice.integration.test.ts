import { randomUUID } from "node:crypto";

import {
  HUMAN_WORKSPACE_ROLES,
  USER_STATUSES,
  type UserId,
  type WorkspaceId,
} from "@osva-ai/contracts";
import type {
  OrganizationId,
  OrganizationMembershipId,
} from "@osva-ai/contracts";
import {
  IdentityApplication,
  IdentityBootstrapApplication,
  OrganizationMembership,
  Workspace,
  createApiKeyApplication,
} from "@osva/domain";
import { ORGANIZATION_MEMBERSHIP_ROLES } from "@osva-ai/contracts";
import {
  createDatabase,
  migrateDatabase,
  PostgresApiKeyRepository,
  PostgresAuthSessionRepository,
  PostgresIdentityLifecycleRepository,
  PostgresOrganizationMembershipRepository,
  PostgresOrganizationRepository,
  PostgresSecurityAuditEventRepository,
  PostgresUserRepository,
  PostgresWorkspaceMembershipRepository,
  PostgresWorkspaceRepository,
  type Database,
} from "@osva/db";
import { BetterAuthOperatorPasswordTokenService } from "@osva/adapters-auth";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createWebProcess } from "../../src/process.js";
import {
  resetStage0Tables,
  startPostgresForTests,
  stopPostgresForTests,
  type PostgresTestContext,
} from "../../../../packages/db/test/integration/postgres-harness.js";
import {
  startValkeyForTests,
  stopValkeyForTests,
  type ValkeyTestContext,
} from "../../../../adapters/bullmq/test/integration/valkey-harness.js";

const AUTH_SECRET = "integration-test-auth-secret-with-length-32";
const NOW = new Date("2026-01-15T12:00:00.000Z");
const WS_A = "ws-slice-a" as WorkspaceId;
const WS_B = "ws-slice-b" as WorkspaceId;
const PASSWORD = "Slice2-Test-Password-12!";
const OWNER_EMAIL = "owner@slice.test";

describe("M11 Slice 2 human identity integration", () => {
  let postgres: PostgresTestContext;
  let valkey: ValkeyTestContext;
  let database: Database;

  beforeAll(async () => {
    postgres = await startPostgresForTests();
    valkey = await startValkeyForTests();
    database = createDatabase({
      connectionString: postgres.connectionString,
      max: 10,
      connectTimeoutSeconds: 10,
    });
    await migrateDatabase(database);
  }, 120_000);

  afterAll(async () => {
    await database?.close();
    await stopPostgresForTests(postgres);
    await stopValkeyForTests(valkey);
  });

  beforeEach(async () => {
    await resetStage0Tables(database);
    const workspaces = new PostgresWorkspaceRepository(database);
    await workspaces.save(
      Workspace.create({ id: WS_A, name: "Workspace A", createdAt: NOW }),
    );
    await workspaces.save(
      Workspace.create({ id: WS_B, name: "Workspace B", createdAt: NOW }),
    );
  });

  async function bootstrapOrganization(
    workspaceIds: readonly WorkspaceId[],
  ): Promise<{ ownerUserId: UserId; organizationId: OrganizationId }> {
    const bootstrap = new IdentityBootstrapApplication({
      organizations: new PostgresOrganizationRepository(database),
      users: new PostgresUserRepository(database),
      workspaces: new PostgresWorkspaceRepository(database),
      workspaceMemberships: new PostgresWorkspaceMembershipRepository(database),
      lifecycle: new PostgresIdentityLifecycleRepository(database),
      securityAuditEvents: new PostgresSecurityAuditEventRepository(database),
      clock: { now: () => NOW },
      ids: { createId: () => randomUUID() },
    });
    const result = await bootstrap.bootstrapExistingInstallation({
      organizationName: "Slice Org",
      ownerEmail: OWNER_EMAIL,
      ownerDisplayName: "Owner",
      workspaceIds: [...workspaceIds],
      allUnlinkedWorkspaces: false,
    });
    return {
      ownerUserId: result.ownerUserId,
      organizationId: result.organizationId,
    };
  }

  async function completeOwnerSetup(origin: string): Promise<void> {
    const passwordTokens = new BetterAuthOperatorPasswordTokenService({
      database,
      secret: AUTH_SECRET,
      baseURL: origin,
      trustedOrigins: [origin],
    });
    const issued = await passwordTokens.issuePasswordResetToken({
      email: OWNER_EMAIL,
      redirectTo: `${origin}/v1/auth/setup/complete`,
    });
    const setup = await fetch(`${origin}/v1/auth/setup/complete`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin,
      },
      body: JSON.stringify({ token: issued.token, password: PASSWORD }),
    });
    expect(setup.status).toBe(200);
    const owner = await new PostgresUserRepository(database).findByEmail(
      OWNER_EMAIL,
    );
    expect(owner?.status).toBe(USER_STATUSES.ACTIVE);
  }

  async function login(origin: string, email: string): Promise<string> {
    const response = await fetch(`${origin}/v1/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json", origin },
      body: JSON.stringify({ email, password: PASSWORD }),
    });
    expect(response.status).toBe(200);
    const cookie = response.headers.get("set-cookie") ?? "";
    return cookie.split(";")[0] ?? "";
  }

  function identityApp(): IdentityApplication {
    return new IdentityApplication({
      users: new PostgresUserRepository(database),
      workspaceMemberships: new PostgresWorkspaceMembershipRepository(database),
      workspaces: new PostgresWorkspaceRepository(database),
      lifecycle: new PostgresIdentityLifecycleRepository(database),
      organizationMemberships: new PostgresOrganizationMembershipRepository(
        database,
      ),
      clock: { now: () => NOW },
      ids: { createId: () => randomUUID() },
    });
  }

  async function withWeb<T>(fn: (origin: string) => Promise<T>): Promise<T> {
    const testPort = 38_429;
    const origin = `http://127.0.0.1:${String(testPort)}`;
    const web = createWebProcess({
      OSVA_DATABASE_URL: postgres.connectionString,
      OSVA_VALKEY_URL: valkey.url,
      OSVA_WEB_HOST: "127.0.0.1",
      OSVA_WEB_PORT: String(testPort),
      OSVA_AUTH_SECRET: AUTH_SECRET,
      OSVA_AUTH_BASE_URL: origin,
      OSVA_AUTH_TRUSTED_ORIGINS: origin,
      OSVA_ALLOW_DETERMINISTIC_EMBEDDINGS: "true",
      OSVA_KNOWLEDGE_EMBEDDING_PROVIDER: "DETERMINISTIC",
    });
    await web.listen();
    try {
      return await fn(origin);
    } finally {
      await web.stop();
    }
  }

  it("exercises human auth, membership mutations, ownership, and audit hygiene", async () => {
    const { ownerUserId, organizationId } = await bootstrapOrganization([WS_A]);

    await withWeb(async (origin) => {
      await completeOwnerSetup(origin);
      const ownerCookie = await login(origin, OWNER_EMAIL);

      const session = await fetch(`${origin}/v1/auth/session`, {
        headers: { cookie: ownerCookie },
      });
      expect(session.status).toBe(200);

      const permittedControlPlane = await fetch(
        `${origin}/v1/auth/workspaces/${WS_A}/memberships`,
        {
          headers: { cookie: ownerCookie, "x-osva-workspace-id": WS_A },
        },
      );
      expect(permittedControlPlane.status).toBe(200);

      const identity = identityApp();
      const provision = await fetch(
        `${origin}/v1/auth/workspaces/${WS_A}/members/users`,
        {
          method: "POST",
          headers: {
            cookie: ownerCookie,
            "content-type": "application/json",
            origin,
            "x-osva-workspace-id": WS_A,
          },
          body: JSON.stringify({
            email: "pending@slice.test",
            displayName: "Pending",
            role: HUMAN_WORKSPACE_ROLES.VIEWER,
          }),
        },
      );
      expect(provision.status).toBe(201);
      const { setupToken, user: provisionedUser } =
        (await provision.json()) as {
          setupToken: string;
          user: { userId: string };
        };
      const verificationRows = await database.sql<{ value: string }[]>`
        select value from auth_verifications
      `;
      for (const row of verificationRows) {
        expect(row.value).not.toContain(setupToken);
      }

      const setupResponse = await fetch(`${origin}/v1/auth/setup/complete`, {
        method: "POST",
        headers: { "content-type": "application/json", origin },
        body: JSON.stringify({ token: setupToken, password: PASSWORD }),
      });
      expect(setupResponse.status).toBe(200);
      const activated = await new PostgresUserRepository(database).findById(
        provisionedUser.userId as UserId,
      );
      expect(activated?.status).toBe(USER_STATUSES.ACTIVE);

      const pendingCookie = await login(origin, "pending@slice.test");
      const self = await fetch(`${origin}/v1/auth/me`, {
        headers: { cookie: pendingCookie },
      });
      expect(self.status).toBe(200);

      const allowedWorkspace = await fetch(`${origin}/v1/me/workspaces`, {
        headers: { cookie: pendingCookie },
      });
      expect(allowedWorkspace.status).toBe(200);
      const workspaceBody = (await allowedWorkspace.json()) as {
        workspaces: Array<{ workspaceId: string }>;
      };
      expect(workspaceBody.workspaces.map((w) => w.workspaceId)).toEqual([
        WS_A,
      ]);

      const isolated = await fetch(
        `${origin}/v1/auth/workspaces/${WS_B}/memberships`,
        {
          headers: { cookie: pendingCookie, "x-osva-workspace-id": WS_B },
        },
      );
      expect(isolated.status).toBe(403);

      const reuse = await fetch(`${origin}/v1/auth/setup/complete`, {
        method: "POST",
        headers: { "content-type": "application/json", origin },
        body: JSON.stringify({ token: setupToken, password: PASSWORD }),
      });
      expect(reuse.status).toBe(400);

      const membershipsResponse = await fetch(
        `${origin}/v1/auth/workspaces/${WS_A}/memberships`,
        {
          headers: { cookie: ownerCookie, "x-osva-workspace-id": WS_A },
        },
      );
      const { memberships } = (await membershipsResponse.json()) as {
        memberships: Array<{ id: string; userId: string; role: string }>;
      };
      const pendingMembership = memberships.find(
        (m) => m.userId === provisionedUser.userId,
      )!;

      await fetch(
        `${origin}/v1/auth/workspaces/${WS_A}/memberships/${pendingMembership.id}`,
        {
          method: "PATCH",
          headers: {
            cookie: ownerCookie,
            "content-type": "application/json",
            origin,
            "x-osva-workspace-id": WS_A,
          },
          body: JSON.stringify({ role: HUMAN_WORKSPACE_ROLES.OPERATOR }),
        },
      );

      const viewerPatchDenied = await fetch(
        `${origin}/v1/auth/workspaces/${WS_A}/memberships/${pendingMembership.id}`,
        {
          method: "PATCH",
          headers: {
            cookie: await login(origin, "pending@slice.test"),
            "content-type": "application/json",
            origin,
            "x-osva-workspace-id": WS_A,
          },
          body: JSON.stringify({ role: HUMAN_WORKSPACE_ROLES.ADMIN }),
        },
      );
      expect(viewerPatchDenied.status).toBe(403);

      await fetch(
        `${origin}/v1/auth/workspaces/${WS_A}/memberships/${pendingMembership.id}`,
        {
          method: "DELETE",
          headers: { cookie: ownerCookie, origin, "x-osva-workspace-id": WS_A },
        },
      );

      const crossWorkspace = await fetch(
        `${origin}/v1/auth/workspaces/${WS_B}/memberships`,
        {
          headers: { cookie: ownerCookie, "x-osva-workspace-id": WS_A },
        },
      );
      expect(crossWorkspace.status).toBe(403);

      const dev = await identity.registerUser({
        email: "dev@slice.test",
        displayName: "Dev",
      });
      await new PostgresOrganizationMembershipRepository(database).save(
        OrganizationMembership.create({
          id: randomUUID() as OrganizationMembershipId,
          organizationId,
          userId: dev.id,
          role: ORGANIZATION_MEMBERSHIP_ROLES.MEMBER,
          createdAt: NOW,
        }),
      );
      await identity.addExistingUserToWorkspaceMembership({
        workspaceId: WS_A,
        userId: dev.id,
        role: HUMAN_WORKSPACE_ROLES.ADMIN,
        actorUserId: ownerUserId,
      });
      const devMembership = (
        await (
          await fetch(`${origin}/v1/auth/workspaces/${WS_A}/memberships`, {
            headers: { cookie: ownerCookie, "x-osva-workspace-id": WS_A },
          })
        ).json()
      ).memberships.find((m: { userId: string }) => m.userId === dev.id)!;

      await fetch(
        `${origin}/v1/auth/workspaces/${WS_A}/memberships/${devMembership.id}/grant-owner`,
        {
          method: "POST",
          headers: { cookie: ownerCookie, "x-osva-workspace-id": WS_A },
        },
      );

      await fetch(`${origin}/v1/auth/workspaces/${WS_A}/ownership/transfer`, {
        method: "POST",
        headers: {
          cookie: ownerCookie,
          "content-type": "application/json",
          "x-osva-workspace-id": WS_A,
        },
        body: JSON.stringify({ toUserId: dev.id }),
      });

      const ownerRow = memberships.find((m) => m.userId === ownerUserId);
      if (ownerRow !== undefined) {
        const deleteOwner = await fetch(
          `${origin}/v1/auth/workspaces/${WS_A}/memberships/${ownerRow.id}`,
          {
            method: "DELETE",
            headers: {
              cookie: ownerCookie,
              origin,
              "x-osva-workspace-id": WS_A,
            },
          },
        );
        expect([403, 404]).toContain(deleteOwner.status);
      }

      const auditSerialized = JSON.stringify(
        await database.sql`select details from security_audit_events`,
      );
      expect(auditSerialized).not.toMatch(/password|session_token|setupToken/i);
    });
  }, 180_000);

  it("rejects absolutely expired sessions over HTTP, clears cookie, and preserves API keys", async () => {
    await bootstrapOrganization([WS_A]);
    const apiKeys = new PostgresApiKeyRepository(database);
    const workspaces = new PostgresWorkspaceRepository(database);
    const boot = await createApiKeyApplication({
      apiKeys,
      workspaces,
      clock: { now: () => NOW },
      ids: { createId: () => randomUUID() },
    }).bootstrapInstallation.execute({ workspaceId: WS_A });

    await withWeb(async (origin) => {
      await completeOwnerSetup(origin);
      const cookie = await login(origin, OWNER_EMAIL);
      const sessionBefore = await fetch(`${origin}/v1/auth/session`, {
        headers: { cookie },
      });
      expect(sessionBefore.status).toBe(200);
      const sessionBody = (await sessionBefore.json()) as {
        sessionId: string;
      };
      const sessionToken = decodeURIComponent(
        cookie.split("=")[1]?.split(";")[0] ?? "",
      );

      await database.sql`
        UPDATE auth_sessions
        SET
          created_at = now() - interval '7 days' - interval '1 second',
          expires_at = now() + interval '12 hours',
          updated_at = now()
        WHERE id = ${sessionBody.sessionId}
          OR token = ${sessionToken}
      `;

      const sessionAfter = await fetch(`${origin}/v1/auth/session`, {
        headers: { cookie },
      });
      expect(sessionAfter.status).toBe(401);
      const clearedCookie = sessionAfter.headers.get("set-cookie") ?? "";
      expect(clearedCookie).toMatch(/osva\.session_token=;/);
      expect(clearedCookie).toMatch(/Max-Age=0/i);

      const rows = await database.sql<{ id: string }[]>`
        SELECT id FROM auth_sessions WHERE id = ${sessionBody.sessionId}
      `;
      expect(rows).toHaveLength(0);

      const apiAgents = await fetch(`${origin}/v1/agents`, {
        headers: { authorization: `Bearer ${boot.plaintextToken}` },
      });
      expect(apiAgents.status).toBe(200);
    });
  }, 120_000);

  it("revokes human sessions and keeps API-key authentication working", async () => {
    await bootstrapOrganization([WS_A]);
    const apiKeys = new PostgresApiKeyRepository(database);
    const workspaces = new PostgresWorkspaceRepository(database);
    const boot = await createApiKeyApplication({
      apiKeys,
      workspaces,
      clock: { now: () => NOW },
      ids: { createId: () => randomUUID() },
    }).bootstrapInstallation.execute({ workspaceId: WS_A });

    await withWeb(async (origin) => {
      await completeOwnerSetup(origin);
      const cookie = await login(origin, OWNER_EMAIL);
      const sessions = new PostgresAuthSessionRepository(database);
      const sessionJson = (await (
        await fetch(`${origin}/v1/auth/session`, { headers: { cookie } })
      ).json()) as { userId: UserId };
      await sessions.revokeAllSessionsForUser(sessionJson.userId);
      const after = await fetch(`${origin}/v1/auth/session`, {
        headers: { cookie },
      });
      expect(after.status).toBe(401);

      const apiAgents = await fetch(`${origin}/v1/agents`, {
        headers: { authorization: `Bearer ${boot.plaintextToken}` },
      });
      expect(apiAgents.status).toBe(200);
    });
  }, 120_000);
});
