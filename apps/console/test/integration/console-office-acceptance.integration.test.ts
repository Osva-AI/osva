import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  HUMAN_WORKSPACE_ROLES,
  type UserId,
  type WorkspaceId,
} from "@osva-ai/contracts";
import type { WorkspaceMembershipId } from "@osva-ai/contracts";
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

const consoleClientDistDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../dist/client",
);

const WS_A = "ws-office-a" as WorkspaceId;
const WS_B = "ws-office-b" as WorkspaceId;
const NOW = new Date("2026-01-15T12:00:00.000Z");
const PASSWORD = "Office-Accept-Pw-12!";
const OWNER_EMAIL = "owner.office.accept@test.local";
const TEST_USER_EMAIL = "human.office.accept@test.local";

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

function consoleHeaders(
  jar: CookieJar,
  consoleOrigin: string,
  workspaceId: WorkspaceId,
): HeadersInit {
  return {
    cookie: jar.header() ?? "",
    origin: consoleOrigin,
    "x-osva-workspace-id": workspaceId,
  };
}

describe("M22.1 Virtual Office acceptance (real stack)", () => {
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

  beforeEach(async () => {
    await resetStage0Tables(database);
  });

  async function bootstrapStack(): Promise<{
    web: ReturnType<typeof createWebProcess>;
    consoleOrigin: string;
    consoleServer: ReturnType<typeof createConsoleServer>;
    jar: CookieJar;
    agentIdA: string;
  }> {
    const workspaces = new PostgresWorkspaceRepository(database);
    for (const [id, name] of [
      [WS_A, "Office A"],
      [WS_B, "Office B"],
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
    await bootstrap.bootstrapExistingInstallation({
      organizationName: "Office Accept Org",
      ownerEmail: OWNER_EMAIL,
      ownerDisplayName: "Owner",
      workspaceIds: [WS_A, WS_B],
      allUnlinkedWorkspaces: false,
    });

    const { webPort, consolePort } = await allocateWebAndConsolePorts();
    const consoleOrigin = loopbackOrigin(consolePort);
    const webOrigin = `http://127.0.0.1:${String(webPort)}`;
    const web = createWebProcess({
      OSVA_DATABASE_URL: postgres.connectionString,
      OSVA_VALKEY_URL: valkey.url,
      OSVA_WEB_HOST: "127.0.0.1",
      OSVA_WEB_PORT: String(webPort),
      OSVA_AUTH_SECRET: TEST_AUTH_SECRET,
      OSVA_AUTH_BASE_URL: webOrigin,
      OSVA_AUTH_TRUSTED_ORIGINS: `${webOrigin},${consoleOrigin}`,
      OSVA_ALLOW_DETERMINISTIC_EMBEDDINGS: "true",
      OSVA_KNOWLEDGE_EMBEDDING_PROVIDER: "DETERMINISTIC",
      OSVA_RATE_LIMIT_UNAUTH_PER_MINUTE: "100000",
      OSVA_RATE_LIMIT_AUTH_PER_MINUTE: "100000",
    });
    await web.listen();

    await bootstrapIntegrationAuth(database, WS_A, NOW, WS_A);
    const agentCreated = await fetchJson(`${webOrigin}/v1/agents`, {
      method: "POST",
      body: { key: "accept-agent", name: "Accept Agent" },
    });
    expect(agentCreated.status).toBe(201);
    const agentIdA = (agentCreated.body as { id: string }).id;

    const passwordTokens = new BetterAuthOperatorPasswordTokenService({
      database,
      secret: TEST_AUTH_SECRET,
      baseURL: webOrigin,
      trustedOrigins: [webOrigin],
    });
    const ownerToken = (
      await passwordTokens.issuePasswordResetToken({
        email: OWNER_EMAIL,
        redirectTo: `${webOrigin}/v1/auth/setup/complete`,
      })
    ).token;
    await fetch(`${webOrigin}/v1/auth/setup/complete`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: webOrigin },
      body: JSON.stringify({ token: ownerToken, password: PASSWORD }),
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
          displayName: "Office Tester",
          role: HUMAN_WORKSPACE_ROLES.DEVELOPER,
        }),
      },
    );
    const { setupToken, user } = (await provision.json()) as {
      setupToken: string;
      user: { userId: string };
    };
    await new PostgresWorkspaceMembershipRepository(database).save(
      WorkspaceMembership.create({
        id: randomUUID() as WorkspaceMembershipId,
        workspaceId: WS_B,
        userId: user.userId as UserId,
        role: HUMAN_WORKSPACE_ROLES.DEVELOPER,
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
        browserOrigin: consoleOrigin,
      },
    });
    await new Promise<void>((resolve) =>
      consoleServer.listen(consolePort, resolve),
    );

    const jar = new CookieJar();
    await fetch(`${consoleOrigin}/api/v1/auth/setup/complete`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: consoleOrigin,
      },
      body: JSON.stringify({ token: setupToken, password: PASSWORD }),
    }).then((r) => jar.absorb(r));

    const login = await fetch(`${consoleOrigin}/api/v1/auth/login`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: consoleOrigin,
      },
      body: JSON.stringify({ email: TEST_USER_EMAIL, password: PASSWORD }),
    });
    jar.absorb(login);
    expect(login.status).toBe(200);

    return {
      web,
      consoleOrigin,
      consoleServer,
      jar,
      agentIdA,
    };
  }

  it("persists Virtual Office records with workspace isolation via Console BFF", async () => {
    const ctx = await bootstrapStack();
    const { web, consoleOrigin, consoleServer, jar, agentIdA } = ctx;

    try {
      const anon = await fetch(`${consoleOrigin}/api/v1/office/workers`);
      expect(anon.status).toBe(401);

      const browserAuth = await fetch(
        `${consoleOrigin}/api/v1/office/workers`,
        {
          headers: {
            authorization: `Bearer ${integrationAuth.token}`,
            "x-osva-workspace-id": WS_A,
          },
        },
      );
      expect(browserAuth.status).toBe(403);

      const launchProxied = await fetch(
        `${consoleOrigin}/api/v1/office/assignments/asn-test/launch`,
        {
          method: "POST",
          headers: {
            ...consoleHeaders(jar, consoleOrigin, WS_A),
            "content-type": "application/json",
          },
          body: "{}",
        },
      );
      expect(launchProxied.status).toBe(404);

      const cancelProxied = await fetch(
        `${consoleOrigin}/api/v1/office/assignments/asn-test/cancel`,
        {
          method: "POST",
          headers: {
            ...consoleHeaders(jar, consoleOrigin, WS_A),
            "content-type": "application/json",
          },
          body: "{}",
        },
      );
      expect(cancelProxied.status).toBe(404);

      const workerRes = await fetch(`${consoleOrigin}/api/v1/office/workers`, {
        method: "POST",
        headers: {
          ...consoleHeaders(jar, consoleOrigin, WS_A),
          "content-type": "application/json",
        },
        body: JSON.stringify({
          key: "writer",
          name: "Writer",
          description: "Acceptance worker",
          agentId: agentIdA,
        }),
      });
      const workerBody = (await workerRes.json()) as {
        id: string;
        name: string;
      };
      expect(workerRes.status).toBe(201);
      expect(JSON.stringify(workerBody)).not.toContain(integrationAuth.token);

      const teamRes = await fetch(`${consoleOrigin}/api/v1/office/teams`, {
        method: "POST",
        headers: {
          ...consoleHeaders(jar, consoleOrigin, WS_A),
          "content-type": "application/json",
        },
        body: JSON.stringify({
          key: "core",
          name: "Core Team",
          description: "Acceptance team",
        }),
      });
      const teamBody = (await teamRes.json()) as { id: string };
      expect(teamRes.status).toBe(201);

      const roleRes = await fetch(`${consoleOrigin}/api/v1/office/roles`, {
        method: "POST",
        headers: {
          ...consoleHeaders(jar, consoleOrigin, WS_A),
          "content-type": "application/json",
        },
        body: JSON.stringify({
          key: "lead",
          name: "Lead",
        }),
      });
      const roleBody = (await roleRes.json()) as { id: string };
      expect(roleRes.status).toBe(201);

      const memberRes = await fetch(
        `${consoleOrigin}/api/v1/office/teams/${teamBody.id}/memberships`,
        {
          method: "POST",
          headers: {
            ...consoleHeaders(jar, consoleOrigin, WS_A),
            "content-type": "application/json",
          },
          body: JSON.stringify({
            officeWorkerId: workerBody.id,
            roleId: roleBody.id,
          }),
        },
      );
      expect(memberRes.status).toBe(201);

      const workerDetail = await fetch(
        `${consoleOrigin}/api/v1/office/workers/${workerBody.id}`,
        { headers: consoleHeaders(jar, consoleOrigin, WS_A) },
      );
      expect(workerDetail.status).toBe(200);

      const teamDetail = await fetch(
        `${consoleOrigin}/api/v1/office/teams/${teamBody.id}`,
        { headers: consoleHeaders(jar, consoleOrigin, WS_A) },
      );
      expect(teamDetail.status).toBe(200);

      const patchWorker = await fetch(
        `${consoleOrigin}/api/v1/office/workers/${workerBody.id}`,
        {
          method: "PATCH",
          headers: {
            ...consoleHeaders(jar, consoleOrigin, WS_A),
            "content-type": "application/json",
          },
          body: JSON.stringify({ name: "Writer Updated" }),
        },
      );
      expect(patchWorker.status).toBe(200);

      const persistedWorker = await fetch(
        `${consoleOrigin}/api/v1/office/workers/${workerBody.id}`,
        { headers: consoleHeaders(jar, consoleOrigin, WS_A) },
      );
      expect(persistedWorker.status).toBe(200);
      expect(((await persistedWorker.json()) as { name: string }).name).toBe(
        "Writer Updated",
      );

      const workersList = await fetch(
        `${consoleOrigin}/api/v1/office/workers`,
        {
          headers: consoleHeaders(jar, consoleOrigin, WS_A),
        },
      );
      const teamsList = await fetch(`${consoleOrigin}/api/v1/office/teams`, {
        headers: consoleHeaders(jar, consoleOrigin, WS_A),
      });
      expect(
        ((await workersList.json()) as { items: unknown[] }).items,
      ).toHaveLength(1);
      expect(
        ((await teamsList.json()) as { items: unknown[] }).items,
      ).toHaveLength(1);

      const goalRes = await fetch(`${consoleOrigin}/api/v1/office/goals`, {
        method: "POST",
        headers: {
          ...consoleHeaders(jar, consoleOrigin, WS_A),
          "content-type": "application/json",
        },
        body: JSON.stringify({ key: "mission-1", title: "Acceptance mission" }),
      });
      expect(goalRes.status).toBe(201);
      const goalBody = (await goalRes.json()) as { id: string; status: string };
      expect(goalBody.status).toBe("OPEN");

      const agentVersionRes = await fetch(
        `${consoleOrigin}/api/v1/agents/${agentIdA}/versions`,
        {
          method: "POST",
          headers: {
            ...consoleHeaders(jar, consoleOrigin, WS_A),
            "content-type": "application/json",
          },
          body: JSON.stringify({
            manifest: {
              schemaVersion: "1",
              key: "accept-agent",
              name: "Accept Agent",
              runtime: {
                type: "REMOTE_HTTP",
                protocolVersion: "1",
                endpoint: "http://127.0.0.1:59999/noop",
              },
              input: { schema: {} },
              output: { schema: {} },
              execution: { timeoutMs: 5_000, maxAttempts: 1 },
              capabilities: { model: false, tools: [] },
            },
          }),
        },
      );
      expect(agentVersionRes.status).toBe(201);
      const agentVersionBody = (await agentVersionRes.json()) as { id: string };

      const assignmentRes = await fetch(
        `${consoleOrigin}/api/v1/office/assignments`,
        {
          method: "POST",
          headers: {
            ...consoleHeaders(jar, consoleOrigin, WS_A),
            "content-type": "application/json",
          },
          body: JSON.stringify({
            goalId: goalBody.id,
            officeWorkerId: workerBody.id,
            title: "Draft deliverable",
            targetType: "AGENT_VERSION",
            targetVersionId: agentVersionBody.id,
            input: { schemaVersion: "1" },
          }),
        },
      );
      expect(assignmentRes.status).toBe(201);
      const assignmentBody = (await assignmentRes.json()) as {
        id: string;
        status: string;
        runId?: string;
      };
      expect(assignmentBody.status).toBe("PENDING");
      expect(assignmentBody.runId).toBeUndefined();

      const assignmentId = assignmentBody.id;
      const launchRes = await fetch(
        `${consoleOrigin}/api/v1/office/assignments/${assignmentId}/launch`,
        {
          method: "POST",
          headers: {
            ...consoleHeaders(jar, consoleOrigin, WS_A),
            "content-type": "application/json",
          },
          body: "{}",
        },
      );
      expect(launchRes.status).toBe(200);
      const launched = (await launchRes.json()) as {
        status: string;
        runId?: string;
      };
      expect(launched.status).toBe("RUNNING");
      expect(launched.runId).toBeDefined();

      const detailAfterLaunch = await fetch(
        `${consoleOrigin}/api/v1/office/assignments/${assignmentId}`,
        { headers: consoleHeaders(jar, consoleOrigin, WS_A) },
      );
      expect(detailAfterLaunch.status).toBe(200);
      const detailBody = (await detailAfterLaunch.json()) as {
        status: string;
        runId?: string;
      };
      expect(detailBody.status).toBe("RUNNING");
      expect(detailBody.runId).toBe(launched.runId);

      const goalsB = await fetch(`${consoleOrigin}/api/v1/office/goals`, {
        headers: consoleHeaders(jar, consoleOrigin, WS_B),
      });
      expect(
        ((await goalsB.json()) as { items: unknown[] }).items,
      ).toHaveLength(0);

      const workersB = await fetch(`${consoleOrigin}/api/v1/office/workers`, {
        headers: consoleHeaders(jar, consoleOrigin, WS_B),
      });
      expect(
        ((await workersB.json()) as { items: unknown[] }).items,
      ).toHaveLength(0);

      const crossTeam = await fetch(
        `${consoleOrigin}/api/v1/office/teams/${teamBody.id}`,
        { headers: consoleHeaders(jar, consoleOrigin, WS_B) },
      );
      expect(crossTeam.status).toBe(404);

      const crossWorker = await fetch(
        `${consoleOrigin}/api/v1/office/workers/${workerBody.id}`,
        { headers: consoleHeaders(jar, consoleOrigin, WS_B) },
      );
      expect(crossWorker.status).toBe(404);

      const workersAAgain = await fetch(
        `${consoleOrigin}/api/v1/office/workers`,
        {
          headers: consoleHeaders(jar, consoleOrigin, WS_A),
        },
      );
      expect(
        ((await workersAAgain.json()) as { items: Array<{ id: string }> })
          .items[0]?.id,
      ).toBe(workerBody.id);
    } finally {
      await new Promise<void>((resolve, reject) => {
        consoleServer.close((error) => (error ? reject(error) : resolve()));
      });
      await web.stop();
    }
  }, 180_000);
});
