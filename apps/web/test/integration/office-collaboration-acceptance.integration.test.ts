import { randomUUID } from "node:crypto";

import {
  COMMUNITY_EDITION_ROLES,
  HUMAN_WORKSPACE_ROLES,
  OFFICE_MESSAGE_BODY_MAX_LENGTH,
  PUBLIC_API_ERROR_CODES,
  USER_STATUSES,
  type OfficeMessageId,
  type OfficeThreadId,
  type UserId,
  type WorkspaceId,
} from "@osva-ai/contracts";
import type { OrganizationId } from "@osva-ai/contracts";
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

const AUTH_SECRET = "integration-office-collab-auth-secret-32chars";
const PASSWORD = "Collab-Test-Password-12!";
const NOW = new Date("2026-03-15T12:00:00.000Z");
const WS_A = "ws-collab-a" as WorkspaceId;
const WS_B = "ws-collab-b" as WorkspaceId;
const OWNER_EMAIL = "owner@collab.test";
const MEMBER_EMAIL = "member@collab.test";
const ISOLATED_B_EMAIL = "isolated@collab.test";
const WEB_PORT = 38_461;

type JsonResult = {
  readonly status: number;
  readonly body: unknown;
};

async function requestJson(
  origin: string,
  path: string,
  options?: {
    readonly method?: string;
    readonly headers?: Record<string, string>;
    readonly body?: unknown;
  },
): Promise<JsonResult> {
  const response = await fetch(`${origin}${path}`, {
    method: options?.method ?? "GET",
    headers: {
      ...(options?.body === undefined
        ? {}
        : { "content-type": "application/json" }),
      ...options?.headers,
    },
    body:
      options?.body === undefined ? undefined : JSON.stringify(options.body),
  });
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  return { status: response.status, body };
}

function humanHeaders(
  origin: string,
  cookie: string,
  workspaceId: WorkspaceId,
): Record<string, string> {
  return {
    cookie,
    origin,
    "x-osva-workspace-id": workspaceId,
  };
}

describe("M22.2A office collaboration HTTP acceptance", () => {
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
  }, 180_000);

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

  async function bootstrapOrganization(): Promise<{
    ownerUserId: UserId;
    organizationId: OrganizationId;
  }> {
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
      organizationName: "Collab Org",
      ownerEmail: OWNER_EMAIL,
      ownerDisplayName: "Owner",
      workspaceIds: [WS_A, WS_B],
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
    const setup = await requestJson(origin, "/v1/auth/setup/complete", {
      method: "POST",
      headers: { origin },
      body: { token: issued.token, password: PASSWORD },
    });
    expect(setup.status).toBe(200);
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

  async function withWeb<T>(fn: (origin: string) => Promise<T>): Promise<T> {
    const origin = `http://127.0.0.1:${String(WEB_PORT)}`;
    const web = createWebProcess({
      OSVA_DATABASE_URL: postgres.connectionString,
      OSVA_VALKEY_URL: valkey.url,
      OSVA_WEB_HOST: "127.0.0.1",
      OSVA_WEB_PORT: String(WEB_PORT),
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

  it("exercises collaboration, isolation, auth and safety on the control plane", async () => {
    const { ownerUserId, organizationId } = await bootstrapOrganization();

    await withWeb(async (origin) => {
      await completeOwnerSetup(origin);
      const ownerCookie = await login(origin, OWNER_EMAIL);
      const ownerHeaders = humanHeaders(origin, ownerCookie, WS_A);

      async function provisionHuman(
        email: string,
        workspaceId: WorkspaceId,
        role: typeof HUMAN_WORKSPACE_ROLES.DEVELOPER,
      ): Promise<UserId> {
        const provision = await requestJson(
          origin,
          `/v1/auth/workspaces/${workspaceId}/members/users`,
          {
            method: "POST",
            headers: {
              ...humanHeaders(origin, ownerCookie, workspaceId),
              "content-type": "application/json",
            },
            body: {
              email,
              displayName: email,
              role,
            },
          },
        );
        expect(provision.status).toBe(201);
        const { setupToken, user } = provision.body as {
          setupToken: string;
          user: { userId: UserId };
        };
        const setup = await requestJson(origin, "/v1/auth/setup/complete", {
          method: "POST",
          headers: { origin },
          body: { token: setupToken, password: PASSWORD },
        });
        expect(setup.status).toBe(200);
        return user.userId;
      }

      const memberId = await provisionHuman(
        MEMBER_EMAIL,
        WS_A,
        HUMAN_WORKSPACE_ROLES.DEVELOPER,
      );
      const isolatedId = await provisionHuman(
        ISOLATED_B_EMAIL,
        WS_B,
        HUMAN_WORKSPACE_ROLES.DEVELOPER,
      );
      void memberId;
      void isolatedId;
      void organizationId;
      void ownerUserId;
      const activated = await new PostgresUserRepository(database).findByEmail(
        MEMBER_EMAIL,
      );
      expect(activated?.status).toBe(USER_STATUSES.ACTIVE);
      const memberCookie = await login(origin, MEMBER_EMAIL);
      const memberHeaders = humanHeaders(origin, memberCookie, WS_A);
      const isolatedCookie = await login(origin, ISOLATED_B_EMAIL);
      const isolatedHeaders = humanHeaders(origin, isolatedCookie, WS_B);

      const runsBefore = await database.sql<{ c: number }[]>`
        SELECT COUNT(*)::int AS c FROM runs
      `;
      const workflowRunsBefore = await database.sql<{ c: number }[]>`
        SELECT COUNT(*)::int AS c FROM workflow_runs
      `;

      const anon = await requestJson(origin, "/v1/office/threads");
      expect(anon.status).toBe(401);
      expect(anon.body).toMatchObject({
        code: PUBLIC_API_ERROR_CODES.AUTHENTICATION_REQUIRED,
      });

      const apiKeyCreate = await requestJson(origin, "/v1/api-keys", {
        method: "POST",
        headers: {
          ...ownerHeaders,
          "content-type": "application/json",
        },
        body: {
          name: "collab-read",
          role: COMMUNITY_EDITION_ROLES.OPERATOR,
        },
      });
      expect(apiKeyCreate.status).toBe(201);
      const apiToken = (apiKeyCreate.body as { token: string }).token;

      const threadCreated = await requestJson(origin, "/v1/office/threads", {
        method: "POST",
        headers: { ...ownerHeaders, "content-type": "application/json" },
        body: { title: "Mission channel" },
      });
      expect(threadCreated.status).toBe(201);
      const threadId = (threadCreated.body as { id: OfficeThreadId }).id;

      const apiKeyThreadDenied = await requestJson(
        origin,
        "/v1/office/threads",
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${apiToken}`,
            "x-osva-workspace-id": WS_A,
            "content-type": "application/json",
          },
          body: { title: "Blocked" },
        },
      );
      expect(apiKeyThreadDenied.status).toBe(403);

      const firstMessage = await requestJson(
        origin,
        `/v1/office/threads/${threadId}/messages`,
        {
          method: "POST",
          headers: { ...ownerHeaders, "content-type": "application/json" },
          body: {
            body: "Hello from owner",
            idempotencyKey: "msg-idem-accept",
          },
        },
      );
      expect(firstMessage.status).toBe(201);
      const firstMessageId = (firstMessage.body as { id: OfficeMessageId }).id;

      const idempotentReplay = await requestJson(
        origin,
        `/v1/office/threads/${threadId}/messages`,
        {
          method: "POST",
          headers: { ...ownerHeaders, "content-type": "application/json" },
          body: {
            body: "Different body must not apply",
            idempotencyKey: "msg-idem-accept",
          },
        },
      );
      expect(idempotentReplay.status).toBe(201);
      expect((idempotentReplay.body as { id: string }).id).toBe(firstMessageId);
      expect((idempotentReplay.body as { body: string }).body).toBe(
        "Hello from owner",
      );

      const memberThread = await requestJson(
        origin,
        `/v1/office/threads/${threadId}`,
        { headers: memberHeaders },
      );
      expect(memberThread.status).toBe(200);

      const apiKeyList = await requestJson(origin, "/v1/office/threads", {
        headers: {
          authorization: `Bearer ${apiToken}`,
          "x-osva-workspace-id": WS_A,
        },
      });
      expect(apiKeyList.status).toBe(200);
      expect(
        (apiKeyList.body as { items: { id: string }[] }).items.some(
          (item) => item.id === threadId,
        ),
      ).toBe(true);

      const apiKeyInboxDenied = await requestJson(origin, "/v1/office/inbox", {
        headers: {
          authorization: `Bearer ${apiToken}`,
          "x-osva-workspace-id": WS_A,
        },
      });
      expect(apiKeyInboxDenied.status).toBe(403);

      const reply = await requestJson(
        origin,
        `/v1/office/threads/${threadId}/messages`,
        {
          method: "POST",
          headers: { ...memberHeaders, "content-type": "application/json" },
          body: {
            body: "Reply from member",
            parentMessageId: firstMessageId,
          },
        },
      );
      expect(reply.status).toBe(201);

      const history = await requestJson(
        origin,
        `/v1/office/threads/${threadId}/messages?limit=50`,
        { headers: memberHeaders },
      );
      expect(history.status).toBe(200);
      expect(
        (history.body as { items: { sequence: number }[] }).items.map(
          (item) => item.sequence,
        ),
      ).toEqual([1, 2]);

      const memberInbox = await requestJson(origin, "/v1/office/inbox", {
        headers: memberHeaders,
      });
      expect(memberInbox.status).toBe(200);
      expect(
        (memberInbox.body as { items: unknown[] }).items.length,
      ).toBeGreaterThan(0);

      const ownerRead = await requestJson(
        origin,
        "/v1/office/inbox/read-state",
        {
          method: "PATCH",
          headers: { ...ownerHeaders, "content-type": "application/json" },
          body: { threadId, lastReadSequence: 2 },
        },
      );
      expect(ownerRead.status).toBe(200);

      const memberInboxAfterOwnerRead = await requestJson(
        origin,
        "/v1/office/inbox",
        { headers: memberHeaders },
      );
      expect(
        (memberInboxAfterOwnerRead.body as { items: unknown[] }).items.length,
      ).toBeGreaterThan(0);

      const memberRead = await requestJson(
        origin,
        "/v1/office/inbox/read-state",
        {
          method: "PATCH",
          headers: { ...memberHeaders, "content-type": "application/json" },
          body: { threadId, lastReadSequence: 2 },
        },
      );
      expect(memberRead.status).toBe(200);

      const reloaded = await requestJson(
        origin,
        `/v1/office/threads/${threadId}/messages?limit=50`,
        { headers: ownerHeaders },
      );
      expect(
        (reloaded.body as { items: { body: string }[] }).items,
      ).toHaveLength(2);

      const agentRes = await requestJson(origin, "/v1/agents", {
        method: "POST",
        headers: { ...ownerHeaders, "content-type": "application/json" },
        body: { key: "mention-agent", name: "Mention Agent" },
      });
      expect(agentRes.status).toBe(201);
      const agentId = (agentRes.body as { id: string }).id;
      const workerRes = await requestJson(origin, "/v1/office/workers", {
        method: "POST",
        headers: { ...ownerHeaders, "content-type": "application/json" },
        body: {
          key: "analyst",
          name: "Research Analyst",
          agentId,
        },
      });
      expect(workerRes.status).toBe(201);
      const officeWorkerId = (workerRes.body as { id: string }).id;

      const mentionMessage = await requestJson(
        origin,
        `/v1/office/threads/${threadId}/messages`,
        {
          method: "POST",
          headers: { ...memberHeaders, "content-type": "application/json" },
          body: {
            body: "Please review @Research Analyst",
            mentions: [{ kind: "OFFICE_WORKER", officeWorkerId }],
          },
        },
      );
      expect(mentionMessage.status).toBe(201);

      const invalidMention = await requestJson(
        origin,
        `/v1/office/threads/${threadId}/messages`,
        {
          method: "POST",
          headers: { ...memberHeaders, "content-type": "application/json" },
          body: {
            body: "Bad mention",
            mentions: [
              {
                kind: "HUMAN",
                userId: isolatedId,
              },
            ],
          },
        },
      );
      expect(invalidMention.status).toBe(403);

      const runsAfter = await database.sql<{ c: number }[]>`
        SELECT COUNT(*)::int AS c FROM runs
      `;
      const workflowRunsAfter = await database.sql<{ c: number }[]>`
        SELECT COUNT(*)::int AS c FROM workflow_runs
      `;
      expect(runsAfter[0]?.c).toBe(runsBefore[0]?.c);
      expect(workflowRunsAfter[0]?.c).toBe(workflowRunsBefore[0]?.c);

      const crossWorkspaceGet = await requestJson(
        origin,
        `/v1/office/threads/${threadId}`,
        { headers: isolatedHeaders },
      );
      expect(crossWorkspaceGet.status).toBe(404);

      const crossWorkspacePost = await requestJson(
        origin,
        `/v1/office/threads/${threadId}/messages`,
        {
          method: "POST",
          headers: { ...isolatedHeaders, "content-type": "application/json" },
          body: { body: "Should not post" },
        },
      );
      expect(crossWorkspacePost.status).toBe(404);

      const crossReadState = await requestJson(
        origin,
        "/v1/office/inbox/read-state",
        {
          method: "PATCH",
          headers: { ...isolatedHeaders, "content-type": "application/json" },
          body: { threadId, lastReadSequence: 2 },
        },
      );
      expect(crossReadState.status).toBe(404);

      const forgedAuthorship = await requestJson(
        origin,
        `/v1/office/threads/${threadId}/messages`,
        {
          method: "POST",
          headers: { ...memberHeaders, "content-type": "application/json" },
          body: {
            body: "forged",
            authorUserId: ownerUserId,
            authorType: "HUMAN",
          },
        },
      );
      expect(forgedAuthorship.status).toBe(400);

      const oversized = await requestJson(
        origin,
        `/v1/office/threads/${threadId}/messages`,
        {
          method: "POST",
          headers: { ...memberHeaders, "content-type": "application/json" },
          body: { body: "x".repeat(OFFICE_MESSAGE_BODY_MAX_LENGTH + 1) },
        },
      );
      expect(oversized.status).toBe(400);

      const badCursor = await requestJson(
        origin,
        `/v1/office/threads/${threadId}/messages?cursor=@@@`,
        { headers: memberHeaders },
      );
      expect(badCursor.status).toBe(400);

      const unsupported = await requestJson(
        origin,
        `/v1/office/threads/${threadId}`,
        {
          method: "DELETE",
          headers: {
            authorization: `Bearer ${apiToken}`,
            "x-osva-workspace-id": WS_A,
          },
        },
      );
      expect(unsupported.status).toBe(405);
    });
  }, 120_000);
});
