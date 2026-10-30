import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  HUMAN_WORKSPACE_ROLES,
  USER_STATUSES,
  type UserId,
  type WorkspaceId,
} from "@osva-ai/contracts";
import type { OrganizationId, WorkspaceMembershipId } from "@osva-ai/contracts";
import { BetterAuthOperatorPasswordTokenService } from "@osva/adapters-auth";
import {
  IdentityBootstrapApplication,
  Workspace,
  WorkspaceMembership,
} from "@osva/domain";
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

import { createWebProcess } from "../../../web/src/process.js";
import {
  bootstrapIntegrationAuth,
  fetchJson,
  integrationAuth,
} from "../../../worker/test/integration/integration-auth.js";
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
import { TEST_AUTH_SECRET } from "../../../../packages/db/test/integration/web-auth-env.js";
import { createConsoleServer } from "../../src/server/server.js";
import {
  allocateWebAndConsolePorts,
  loopbackOrigin,
} from "./allocate-loopback-port.js";
import { pollUntil } from "./poll-deadline.js";

const consoleClientDistDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../dist/client",
);

const WS_A = "ws-human-a" as WorkspaceId;
const WS_B = "ws-human-b" as WorkspaceId;
const WS_C = "ws-human-c" as WorkspaceId;
const NOW = new Date("2026-01-15T12:00:00.000Z");
const PASSWORD = "Human-Console-Test-Pw-12!";
const TEST_USER_EMAIL = "human.console@test.local";
const OWNER_EMAIL = "owner.human.console@test.local";

class CookieJar {
  private readonly store = new Map<string, string>();

  absorb(response: Response): void {
    const headers = response.headers as Headers & {
      getSetCookie?: () => string[];
    };
    const raw =
      headers.getSetCookie?.() ??
      (response.headers.get("set-cookie")
        ? [response.headers.get("set-cookie")!]
        : []);
    for (const line of raw) {
      const pair = line.split(";")[0]?.trim();
      if (pair === undefined || pair.length === 0) {
        continue;
      }
      const eq = pair.indexOf("=");
      if (eq <= 0) {
        continue;
      }
      const name = pair.slice(0, eq);
      const value = pair.slice(eq + 1);
      if (value.length === 0 || line.toLowerCase().includes("max-age=0")) {
        this.store.delete(name);
      } else {
        this.store.set(name, value);
      }
    }
  }

  header(): string | undefined {
    if (this.store.size === 0) {
      return undefined;
    }
    return [...this.store.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
  }
}

describe("console human session real stack", () => {
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
  }, 120_000);

  afterAll(async () => {
    await database?.close();
    await stopPostgresForTests(postgres);
    await stopValkeyForTests(valkey);
  });

  function createHermeticWebProcess(
    webPort: number,
    extraTrustedOrigins: readonly string[] = [],
  ) {
    const webOrigin = `http://127.0.0.1:${String(webPort)}`;
    const trustedOrigins = [webOrigin, ...extraTrustedOrigins].join(",");
    return {
      webOrigin,
      web: createWebProcess({
        OSVA_DATABASE_URL: postgres.connectionString,
        OSVA_VALKEY_URL: valkey.url,
        OSVA_WEB_HOST: "127.0.0.1",
        OSVA_WEB_PORT: String(webPort),
        OSVA_AUTH_SECRET: TEST_AUTH_SECRET,
        OSVA_AUTH_BASE_URL: webOrigin,
        OSVA_AUTH_TRUSTED_ORIGINS: trustedOrigins,
        OSVA_ALLOW_DETERMINISTIC_EMBEDDINGS: "true",
        OSVA_KNOWLEDGE_EMBEDDING_PROVIDER: "DETERMINISTIC",
        OSVA_RATE_LIMIT_UNAUTH_PER_MINUTE: "100000",
        OSVA_RATE_LIMIT_AUTH_PER_MINUTE: "100000",
      }),
    };
  }

  beforeEach(async () => {
    await resetStage0Tables(database);
  });

  async function bootstrapOwner(): Promise<{
    ownerUserId: UserId;
    organizationId: OrganizationId;
  }> {
    const workspaces = new PostgresWorkspaceRepository(database);
    for (const [id, name] of [
      [WS_A, "Workspace A"],
      [WS_B, "Workspace B"],
      [WS_C, "Workspace C"],
    ] as const) {
      await workspaces.save(Workspace.create({ id, name, createdAt: NOW }));
    }
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
      organizationName: "Human Console Org",
      ownerEmail: OWNER_EMAIL,
      ownerDisplayName: "Owner",
      workspaceIds: [WS_A, WS_C],
      allUnlinkedWorkspaces: false,
    });
    return {
      ownerUserId: result.ownerUserId,
      organizationId: result.organizationId,
    };
  }

  async function issueOwnerSetupToken(webOrigin: string): Promise<string> {
    const passwordTokens = new BetterAuthOperatorPasswordTokenService({
      database,
      secret: TEST_AUTH_SECRET,
      baseURL: webOrigin,
      trustedOrigins: [webOrigin],
    });
    const issued = await passwordTokens.issuePasswordResetToken({
      email: OWNER_EMAIL,
      redirectTo: `${webOrigin}/v1/auth/setup/complete`,
    });
    return issued.token;
  }

  async function seedAgentWithApiKey(
    webOrigin: string,
    workspaceId: WorkspaceId,
    key: string,
  ): Promise<string> {
    await bootstrapIntegrationAuth(database, workspaceId, NOW, workspaceId);
    const created = await fetchJson(`${webOrigin}/v1/agents`, {
      method: "POST",
      body: { key, name: key },
    });
    expect(created.status).toBe(201);
    return (created.body as { id: string }).id;
  }

  async function seedAgentWithOwnerCookie(
    webOrigin: string,
    workspaceId: WorkspaceId,
    ownerCookie: string,
    key: string,
  ): Promise<string> {
    const created = await fetch(`${webOrigin}/v1/agents`, {
      method: "POST",
      headers: {
        cookie: ownerCookie,
        "content-type": "application/json",
        "x-osva-workspace-id": workspaceId,
      },
      body: JSON.stringify({ key, name: key }),
    });
    expect(created.status).toBe(201);
    return ((await created.json()) as { id: string }).id;
  }

  it("accepts human login, workspace isolation, logout, and machine API key compatibility", async () => {
    await bootstrapOwner();

    const { webPort, consolePort } = await allocateWebAndConsolePorts();
    const consoleOrigin = loopbackOrigin(consolePort);
    const { web, webOrigin } = createHermeticWebProcess(webPort, [
      consoleOrigin,
    ]);
    await web.listen();

    const agentIdA = await seedAgentWithApiKey(webOrigin, WS_A, "agent-ws-a");

    const ownerSetupToken = await issueOwnerSetupToken(webOrigin);
    const ownerSetupDirect = await fetch(
      `${webOrigin}/v1/auth/setup/complete`,
      {
        method: "POST",
        headers: { "content-type": "application/json", origin: webOrigin },
        body: JSON.stringify({ token: ownerSetupToken, password: PASSWORD }),
      },
    );
    expect(ownerSetupDirect.status).toBe(200);

    const ownerLogin = await fetch(`${webOrigin}/v1/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: webOrigin },
      body: JSON.stringify({ email: OWNER_EMAIL, password: PASSWORD }),
    });
    const ownerCookie =
      ownerLogin.headers.get("set-cookie")?.split(";")[0] ?? "";
    const agentIdC = await seedAgentWithOwnerCookie(
      webOrigin,
      WS_C,
      ownerCookie,
      "agent-ws-c",
    );

    const provision = await fetch(
      `${webOrigin}/v1/auth/workspaces/${WS_A}/members/users`,
      {
        method: "POST",
        headers: {
          cookie: ownerCookie,
          "content-type": "application/json",
          origin: webOrigin,
          "x-osva-workspace-id": WS_A,
        },
        body: JSON.stringify({
          email: TEST_USER_EMAIL,
          displayName: "Human Console User",
          role: HUMAN_WORKSPACE_ROLES.DEVELOPER,
        }),
      },
    );
    expect(provision.status).toBe(201);
    const { setupToken, user: provisionedUser } = (await provision.json()) as {
      setupToken: string;
      user: { userId: string };
    };

    await new PostgresWorkspaceMembershipRepository(database).save(
      WorkspaceMembership.create({
        id: randomUUID() as WorkspaceMembershipId,
        workspaceId: WS_C,
        userId: provisionedUser.userId as UserId,
        role: HUMAN_WORKSPACE_ROLES.OPERATOR,
        createdAt: NOW,
      }),
    );

    const consoleServer = createConsoleServer({
      config: {
        osvaBaseUrl: webOrigin,
        legacyApiKeyMode: false,
        host: "127.0.0.1",
        port: consolePort,
        clientDistDir: consoleClientDistDir,
        allowedOrigins: [],
        browserOrigin: loopbackOrigin(consolePort),
      },
    });

    await new Promise<void>((resolve) =>
      consoleServer.listen(consolePort, resolve),
    );
    const jar = new CookieJar();
    const consoleOriginHeader = consoleOrigin;

    try {
      const setupViaBff = await fetch(
        `${consoleOrigin}/api/v1/auth/setup/complete`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            origin: consoleOriginHeader,
          },
          body: JSON.stringify({ token: setupToken, password: PASSWORD }),
        },
      );
      jar.absorb(setupViaBff);
      expect(setupViaBff.status).toBe(200);
      expect(JSON.stringify(await setupViaBff.json())).not.toMatch(
        /session_token/i,
      );

      const login = await fetch(`${consoleOrigin}/api/v1/auth/login`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: consoleOriginHeader,
        },
        body: JSON.stringify({
          email: TEST_USER_EMAIL,
          password: PASSWORD,
        }),
      });
      jar.absorb(login);
      const loginBody = await login.json();
      expect(login.status).toBe(200);
      expect(JSON.stringify(loginBody)).not.toContain("session_token");
      expect(integrationAuth.token.length).toBeGreaterThan(0);
      expect(JSON.stringify(loginBody)).not.toContain(integrationAuth.token);

      const browserAuthRejected = await fetch(
        `${consoleOrigin}/api/v1/agents`,
        {
          headers: {
            cookie: jar.header() ?? "",
            origin: consoleOriginHeader,
            authorization: `Bearer ${integrationAuth.token}`,
            "x-osva-workspace-id": WS_A,
          },
        },
      );
      expect(browserAuthRejected.status).toBe(403);

      const session = await fetch(`${consoleOrigin}/api/v1/auth/session`, {
        headers: {
          cookie: jar.header() ?? "",
          origin: consoleOriginHeader,
        },
      });
      jar.absorb(session);
      expect(session.status).toBe(200);
      expect(JSON.stringify(await session.json())).not.toMatch(
        /session_token/i,
      );

      const workspaces = await fetch(
        `${consoleOrigin}/api/v1/auth/workspaces`,
        {
          headers: { cookie: jar.header() ?? "", origin: consoleOriginHeader },
        },
      );
      const workspaceBody = (await workspaces.json()) as {
        workspaces: Array<{ workspaceId: string; role: string }>;
      };
      expect(workspaces.status).toBe(200);
      expect(workspaceBody.workspaces.map((w) => w.workspaceId).sort()).toEqual(
        [WS_A, WS_C].sort(),
      );

      const agentsA = await fetch(`${consoleOrigin}/api/v1/agents`, {
        headers: {
          cookie: jar.header() ?? "",
          origin: consoleOriginHeader,
          "x-osva-workspace-id": WS_A,
        },
      });
      const agentsABody = (await agentsA.json()) as {
        agents: { id: string }[];
      };
      expect(agentsA.status).toBe(200);
      expect(agentsABody.agents.some((a) => a.id === agentIdA)).toBe(true);
      expect(JSON.stringify(agentsABody)).not.toContain(integrationAuth.token);

      const deniedB = await fetch(
        `${consoleOrigin}/api/v1/auth/workspaces/${WS_B}/memberships`,
        {
          headers: {
            cookie: jar.header() ?? "",
            origin: consoleOriginHeader,
            "x-osva-workspace-id": WS_B,
          },
        },
      );
      expect(deniedB.status).toBe(403);

      const agentsC = await fetch(`${consoleOrigin}/api/v1/agents`, {
        headers: {
          cookie: jar.header() ?? "",
          origin: consoleOriginHeader,
          "x-osva-workspace-id": WS_C,
        },
      });
      const agentsCBody = (await agentsC.json()) as {
        agents: { id: string }[];
      };
      expect(agentsC.status).toBe(200);
      expect(agentsCBody.agents.some((a) => a.id === agentIdC)).toBe(true);
      expect(agentsCBody.agents.some((a) => a.id === agentIdA)).toBe(false);

      const logout = await fetch(`${consoleOrigin}/api/v1/auth/logout`, {
        method: "POST",
        headers: {
          cookie: jar.header() ?? "",
          origin: consoleOriginHeader,
        },
      });
      jar.absorb(logout);
      expect(logout.status).toBe(204);
      const cleared = logout.headers.get("set-cookie") ?? "";
      expect(cleared.toLowerCase()).toMatch(/max-age=0|expires=/);

      const staleSession = await fetch(`${consoleOrigin}/api/v1/auth/session`, {
        headers: { cookie: jar.header() ?? "", origin: consoleOriginHeader },
      });
      expect(staleSession.status).toBe(401);

      const machine = await fetch(`${webOrigin}/v1/agents`, {
        headers: { authorization: `Bearer ${integrationAuth.token}` },
      });
      expect(machine.status).toBe(200);

      const activated = await new PostgresUserRepository(database).findByEmail(
        TEST_USER_EMAIL,
      );
      expect(activated?.status).toBe(USER_STATUSES.ACTIVE);
    } finally {
      await new Promise<void>((resolve, reject) => {
        consoleServer.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
      await web.stop();
    }
  }, 120_000);

  it("invalidates workspace selection after membership removal", async () => {
    await bootstrapOwner();
    const { webPort, consolePort } = await allocateWebAndConsolePorts();
    const consoleOrigin = loopbackOrigin(consolePort);
    const { web, webOrigin } = createHermeticWebProcess(webPort, [
      consoleOrigin,
    ]);
    await web.listen();
    const ownerSetupToken = await issueOwnerSetupToken(webOrigin);
    await fetch(`${webOrigin}/v1/auth/setup/complete`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: webOrigin },
      body: JSON.stringify({ token: ownerSetupToken, password: PASSWORD }),
    });
    const ownerLogin = await fetch(`${webOrigin}/v1/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: webOrigin },
      body: JSON.stringify({ email: OWNER_EMAIL, password: PASSWORD }),
    });
    const ownerCookie =
      ownerLogin.headers.get("set-cookie")?.split(";")[0] ?? "";

    const provision = await fetch(
      `${webOrigin}/v1/auth/workspaces/${WS_A}/members/users`,
      {
        method: "POST",
        headers: {
          cookie: ownerCookie,
          "content-type": "application/json",
          origin: webOrigin,
          "x-osva-workspace-id": WS_A,
        },
        body: JSON.stringify({
          email: TEST_USER_EMAIL,
          displayName: "Human Console User",
          role: HUMAN_WORKSPACE_ROLES.VIEWER,
        }),
      },
    );
    const { setupToken } = (await provision.json()) as { setupToken: string };
    await fetch(`${webOrigin}/v1/auth/setup/complete`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: webOrigin },
      body: JSON.stringify({ token: setupToken, password: PASSWORD }),
    });
    const testUserId = (await new PostgresUserRepository(database).findByEmail(
      TEST_USER_EMAIL,
    ))!.id;
    await new PostgresWorkspaceMembershipRepository(database).save(
      WorkspaceMembership.create({
        id: randomUUID() as WorkspaceMembershipId,
        workspaceId: WS_C,
        userId: testUserId,
        role: HUMAN_WORKSPACE_ROLES.VIEWER,
        createdAt: NOW,
      }),
    );

    const consoleServer = createConsoleServer({
      config: {
        osvaBaseUrl: webOrigin,
        legacyApiKeyMode: false,
        host: "127.0.0.1",
        port: consolePort,
        clientDistDir: consoleClientDistDir,
        allowedOrigins: [],
        browserOrigin: loopbackOrigin(consolePort),
      },
    });
    await new Promise<void>((resolve) =>
      consoleServer.listen(consolePort, resolve),
    );
    const jar = new CookieJar();

    try {
      const login = await fetch(`${consoleOrigin}/api/v1/auth/login`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: consoleOrigin,
        },
        body: JSON.stringify({
          email: TEST_USER_EMAIL,
          password: PASSWORD,
        }),
      });
      jar.absorb(login);
      expect(login.status).toBe(200);

      const listC = await fetch(`${consoleOrigin}/api/v1/agents`, {
        headers: {
          cookie: jar.header() ?? "",
          origin: consoleOrigin,
          "x-osva-workspace-id": WS_C,
        },
      });
      expect(listC.status).toBe(200);

      const memberships = await fetch(
        `${webOrigin}/v1/auth/workspaces/${WS_C}/memberships`,
        {
          headers: {
            cookie: ownerCookie,
            "x-osva-workspace-id": WS_C,
          },
        },
      );
      const testUserId = (await new PostgresUserRepository(
        database,
      ).findByEmail(TEST_USER_EMAIL))!.id;
      const memberRow = (
        (await memberships.json()) as {
          memberships: Array<{ id: string; userId: string }>;
        }
      ).memberships.find((m) => m.userId === testUserId)!;

      const removed = await fetch(
        `${webOrigin}/v1/auth/workspaces/${WS_C}/memberships/${memberRow.id}`,
        {
          method: "DELETE",
          headers: {
            cookie: ownerCookie,
            origin: webOrigin,
            "x-osva-workspace-id": WS_C,
          },
        },
      );
      expect(removed.status).toBe(204);

      await pollUntil({
        label: "membership removal visible to BFF",
        deadlineMs: 15_000,
        intervalMs: 500,
        probe: async () => {
          const denied = await fetch(`${consoleOrigin}/api/v1/agents`, {
            headers: {
              cookie: jar.header() ?? "",
              origin: consoleOrigin,
              "x-osva-workspace-id": WS_C,
            },
          });
          return {
            done: denied.status === 403 || denied.status === 401,
            lastState: { status: denied.status },
          };
        },
      });
    } finally {
      await new Promise<void>((resolve, reject) => {
        consoleServer.close((error) => (error ? reject(error) : resolve()));
      });
      await web.stop();
    }
  }, 120_000);
});
