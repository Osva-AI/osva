import { randomUUID } from "node:crypto";
import {
  createDefaultInferenceBudgetPolicyDefinition,
  HUMAN_WORKSPACE_ROLES,
  PUBLIC_API_ERROR_CODES,
  USER_STATUSES,
  type WorkspaceId,
} from "@osva-ai/contracts";
import { IdentityBootstrapApplication, Workspace } from "@osva/domain";
import { BetterAuthOperatorPasswordTokenService } from "@osva/adapters-auth";
import {
  createDatabase,
  migrateDatabase,
  PostgresIdentityLifecycleRepository,
  PostgresOrganizationRepository,
  PostgresSecurityAuditEventRepository,
  PostgresUserRepository,
  PostgresWorkspaceMembershipRepository,
  PostgresWorkspaceRepository,
  type Database,
} from "@osva/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createWebProcess } from "../../src/process.js";
import {
  TEST_AUTH_SECRET,
  withTestAuthEnv,
} from "../../../../packages/db/test/integration/web-auth-env.js";
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

const WEB_PORT = 38_462;
const PASSWORD = "Budget-Human-Password-12!";
const NOW = new Date("2026-06-01T12:00:00.000Z");
const WS_A = "ws-budget-human-a" as WorkspaceId;
const WS_B = "ws-budget-human-b" as WorkspaceId;
const ADMIN_EMAIL = "admin@budget-human.test";
const VIEWER_EMAIL = "viewer@budget-human.test";

const POLICY_BODY = {
  key: "team",
  definition: {
    ...createDefaultInferenceBudgetPolicyDefinition(),
    periodLimitUsdMicros: 5_000_000,
  },
};

describe("B5.5B inference budget human session HTTP authorization", () => {
  let postgres: PostgresTestContext;
  let valkey: ValkeyTestContext;
  let database: Database;

  beforeAll(async () => {
    postgres = await startPostgresForTests();
    valkey = await startValkeyForTests();
    database = createDatabase({
      connectionString: postgres.connectionString,
      max: 8,
      connectTimeoutSeconds: 10,
    });
    await migrateDatabase(database);
  });

  afterAll(async () => {
    await database.close();
    await stopPostgresForTests(postgres);
    await stopValkeyForTests(valkey);
  });

  beforeEach(async () => {
    await resetStage0Tables(database);
    const workspaces = new PostgresWorkspaceRepository(database);
    await workspaces.save(
      Workspace.create({ id: WS_A, name: "Budget A", createdAt: NOW }),
    );
    await workspaces.save(
      Workspace.create({ id: WS_B, name: "Budget B", createdAt: NOW }),
    );
    const bootstrap = new IdentityBootstrapApplication({
      organizations: new PostgresOrganizationRepository(database),
      users: new PostgresUserRepository(database),
      workspaces,
      workspaceMemberships: new PostgresWorkspaceMembershipRepository(database),
      lifecycle: new PostgresIdentityLifecycleRepository(database),
      securityAuditEvents: new PostgresSecurityAuditEventRepository(database),
      clock: { now: () => NOW },
      ids: { createId: () => randomUUID() },
    });
    await bootstrap.bootstrapExistingInstallation({
      organizationName: "Budget Org",
      ownerEmail: ADMIN_EMAIL,
      ownerDisplayName: "Admin",
      workspaceIds: [WS_A, WS_B],
      allUnlinkedWorkspaces: false,
    });
  });

  async function completePasswordSetup(
    origin: string,
    email: string,
  ): Promise<void> {
    const passwordTokens = new BetterAuthOperatorPasswordTokenService({
      database,
      secret: TEST_AUTH_SECRET,
      baseURL: origin,
      trustedOrigins: [origin],
    });
    const issued = await passwordTokens.issuePasswordResetToken({
      email,
      redirectTo: `${origin}/v1/auth/setup/complete`,
    });
    const setup = await fetch(`${origin}/v1/auth/setup/complete`, {
      method: "POST",
      headers: { "content-type": "application/json", origin },
      body: JSON.stringify({ token: issued.token, password: PASSWORD }),
    });
    expect(setup.status).toBe(200);
    const user = await new PostgresUserRepository(database).findByEmail(email);
    expect(user?.status).toBe(USER_STATUSES.ACTIVE);
  }

  async function login(origin: string, email: string): Promise<string> {
    const response = await fetch(`${origin}/v1/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json", origin },
      body: JSON.stringify({ email, password: PASSWORD }),
    });
    expect(response.status).toBe(200);
    return response.headers.get("set-cookie")?.split(";")[0] ?? "";
  }

  function humanHeaders(
    origin: string,
    cookie: string,
    workspaceId: WorkspaceId,
  ) {
    return {
      cookie,
      origin,
      "x-osva-workspace-id": workspaceId,
      "content-type": "application/json",
    };
  }

  it("P-H1–P-H5: human ADMIN create, READ usage, viewer denied, cross-workspace, expired session", async () => {
    const origin = `http://127.0.0.1:${String(WEB_PORT)}`;
    const web = createWebProcess(
      withTestAuthEnv({
        OSVA_DATABASE_URL: postgres.connectionString,
        OSVA_VALKEY_URL: valkey.url,
        OSVA_WEB_HOST: "127.0.0.1",
        OSVA_WEB_PORT: String(WEB_PORT),
        OSVA_AUTH_BASE_URL: origin,
        OSVA_AUTH_TRUSTED_ORIGINS: origin,
        OSVA_ALLOW_DETERMINISTIC_EMBEDDINGS: "true",
        OSVA_KNOWLEDGE_EMBEDDING_PROVIDER: "DETERMINISTIC",
      }),
    );

    await web.listen();

    try {
      await completePasswordSetup(origin, ADMIN_EMAIL);
      const adminCookie = await login(origin, ADMIN_EMAIL);

      const provision = await fetch(
        `${origin}/v1/auth/workspaces/${WS_A}/members/users`,
        {
          method: "POST",
          headers: humanHeaders(origin, adminCookie, WS_A),
          body: JSON.stringify({
            email: VIEWER_EMAIL,
            displayName: "Viewer",
            role: HUMAN_WORKSPACE_ROLES.VIEWER,
          }),
        },
      );
      expect(provision.status).toBe(201);
      const { setupToken } = (await provision.json()) as { setupToken: string };
      const viewerSetup = await fetch(`${origin}/v1/auth/setup/complete`, {
        method: "POST",
        headers: { "content-type": "application/json", origin },
        body: JSON.stringify({ token: setupToken, password: PASSWORD }),
      });
      expect(viewerSetup.status).toBe(200);
      const viewerCookie = await login(origin, VIEWER_EMAIL);

      const session = await fetch(`${origin}/v1/auth/session`, {
        headers: { cookie: adminCookie, origin },
      });
      expect(session.status).toBe(200);

      const created = await fetch(`${origin}/v1/inference-budget-policies`, {
        method: "POST",
        headers: {
          ...humanHeaders(origin, adminCookie, WS_A),
          referer: `${origin}/`,
        },
        body: JSON.stringify(POLICY_BODY),
      });
      if (created.status !== 201) {
        const errBody = await created.text();
        throw new Error(
          `expected human admin create 201, got ${String(created.status)}: ${errBody}`,
        );
      }
      const versionId = ((await created.json()) as { version: { id: string } })
        .version.id;

      const viewerDenied = await fetch(
        `${origin}/v1/inference-budget-policies`,
        {
          method: "POST",
          headers: humanHeaders(origin, viewerCookie, WS_A),
          body: JSON.stringify({ ...POLICY_BODY, key: "denied" }),
        },
      );
      expect(viewerDenied.status).toBe(403);

      const usage = await fetch(
        `${origin}/v1/workspace-inference-budget/period-usage`,
        { headers: humanHeaders(origin, adminCookie, WS_A) },
      );
      expect(usage.status).toBe(200);

      const crossWorkspace = await fetch(
        `${origin}/v1/inference-budget-policy-versions/${versionId}`,
        { headers: humanHeaders(origin, adminCookie, WS_B) },
      );
      expect(crossWorkspace.status).toBe(404);

      const logout = await fetch(`${origin}/v1/auth/logout`, {
        method: "POST",
        headers: { cookie: viewerCookie, origin },
      });
      expect(logout.status).toBe(204);
      const expired = await fetch(
        `${origin}/v1/workspace-inference-budget/configuration`,
        { headers: humanHeaders(origin, viewerCookie, WS_A) },
      );
      expect(expired.status).toBe(401);
      const body = (await expired.json()) as { code?: string };
      expect(body.code).toBe(PUBLIC_API_ERROR_CODES.AUTHENTICATION_REQUIRED);
    } finally {
      await web.stop();
    }
  }, 120_000);
});
