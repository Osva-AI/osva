import { randomUUID } from "node:crypto";

import {
  COMMUNITY_EDITION_ROLES,
  HUMAN_WORKSPACE_ROLES,
  OFFICE_MESSAGE_BODY_MAX_LENGTH,
  PUBLIC_API_ERROR_CODES,
  USER_STATUSES,
  type AgentId,
  type AgentVersionId,
  type ApprovalRequestId,
  type ArtifactId,
  type AssignmentId,
  type OfficeMessageId,
  type OfficeThreadId,
  type OfficeWorkerId,
  type RunAttemptId,
  type RunId,
  type UserId,
  type WorkflowId,
  type WorkflowNodeRunId,
  type WorkflowRunId,
  type WorkflowVersionId,
  type WorkspaceId,
} from "@osva-ai/contracts";
import type { OrganizationId } from "@osva-ai/contracts";
import {
  Agent,
  AgentVersion,
  ApprovalRequest,
  Assignment,
  Artifact,
  IdentityBootstrapApplication,
  OfficeWorker,
  Run,
  RunAttempt,
  Workflow,
  WorkflowNodeRun,
  WorkflowRun,
  WorkflowVersion,
  Workspace,
  inboxItemIdForApproval,
  inboxItemIdForAssignmentUpdate,
  inboxItemIdForDeliverable,
} from "@osva/domain";
import { BetterAuthOperatorPasswordTokenService } from "@osva/adapters-auth";
import {
  createDatabase,
  migrateDatabase,
  PostgresAgentRepository,
  PostgresApprovalRequestRepository,
  PostgresArtifactRepository,
  PostgresIdentityLifecycleRepository,
  PostgresOfficeRepository,
  PostgresOrganizationRepository,
  PostgresRunRepository,
  PostgresSecurityAuditEventRepository,
  PostgresUserRepository,
  PostgresWorkflowRepository,
  PostgresWorkflowRunRepository,
  PostgresWorkspaceMembershipRepository,
  PostgresWorkspaceRepository,
  type Database,
} from "@osva/db";
import {
  createBindings,
  createManifest,
} from "../../../../packages/db/test/integration/fixtures.js";
import type { ModelProfileVersionId } from "@osva-ai/contracts";
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
const VIEWER_EMAIL = "viewer@collab.test";
const OPERATOR_EMAIL = "operator@collab.test";
const ISOLATED_B_EMAIL = "isolated@collab.test";
const WEB_PORT = 38_461;

type InboxItemBody = {
  readonly id: string;
  readonly kind: string;
  readonly approvalRequestId?: string;
  readonly workflowRunId?: string;
  readonly assignmentId?: string;
  readonly artifactId?: string;
  readonly messageId?: string;
};

function inboxItems(body: unknown): readonly InboxItemBody[] {
  return (body as { items: InboxItemBody[] }).items;
}

async function seedPendingApproval(
  database: Database,
  workspaceId: WorkspaceId,
  label: string,
): Promise<{
  readonly approvalRequestId: ApprovalRequestId;
  readonly workflowRunId: WorkflowRunId;
}> {
  const workflows = new PostgresWorkflowRepository(database);
  const workflowRuns = new PostgresWorkflowRunRepository(database);
  const approvals = new PostgresApprovalRequestRepository(database);
  const workflowId = `workflow-${label}` as WorkflowId;
  const workflowVersionId = `workflow-version-${label}` as WorkflowVersionId;
  const workflowRunId = `workflow-run-${label}` as WorkflowRunId;
  const workflowNodeRunId = `node-run-${label}` as WorkflowNodeRunId;
  const approvalRequestId = `approval-${label}` as ApprovalRequestId;

  await workflows.saveWorkflow(
    Workflow.create({
      id: workflowId,
      workspaceId,
      key: `wf-${label}`,
      name: "Workflow",
      createdAt: NOW,
      updatedAt: NOW,
    }),
  );
  await workflows.saveWorkflowVersion(
    WorkflowVersion.create({
      id: workflowVersionId,
      workflowId,
      workspaceId,
      version: 1,
      definition: {
        schemaVersion: "2",
        nodes: [{ key: "review", type: "APPROVAL", title: "Review" }],
        edges: [],
      },
      createdAt: NOW,
    }),
  );
  await workflowRuns.saveWorkflowRun(
    WorkflowRun.create({
      id: workflowRunId,
      workspaceId,
      workflowId,
      workflowVersionId,
      input: { campaign: "launch" },
      createdAt: NOW,
    }),
  );
  await workflowRuns.saveWorkflowNodeRun(
    WorkflowNodeRun.create({
      id: workflowNodeRunId,
      workspaceId,
      workflowRunId,
      workflowNodeKey: "review",
      sequence: 1,
      input: { campaign: "launch" },
      createdAt: NOW,
    }),
  );
  await approvals.saveApprovalRequest(
    ApprovalRequest.create({
      id: approvalRequestId,
      workspaceId,
      workflowRunId,
      workflowNodeRunId,
      createdAt: NOW,
    }),
  );
  return { approvalRequestId, workflowRunId };
}

async function seedOfficeAssignmentGraph(
  database: Database,
  workspaceId: WorkspaceId,
  label: string,
): Promise<{
  readonly officeWorkerId: OfficeWorkerId;
  readonly agentVersionId: AgentVersionId;
}> {
  const agents = new PostgresAgentRepository(database);
  const office = new PostgresOfficeRepository(database);
  const agentId = `agent-${label}` as AgentId;
  const agentVersionId = `agent-version-${label}` as AgentVersionId;
  const officeWorkerId = `office-worker-${label}` as OfficeWorkerId;
  await agents.saveAgent(
    Agent.create({
      id: agentId,
      workspaceId,
      key: `agent-key-${label}`,
      name: "Example Agent",
      createdAt: NOW,
    }),
  );
  await agents.saveAgentVersion(
    AgentVersion.create({
      id: agentVersionId,
      agentId,
      version: 1,
      manifest: createManifest(),
      createdAt: NOW,
    }),
  );
  await office.saveOfficeWorker(
    OfficeWorker.create({
      id: officeWorkerId,
      workspaceId,
      key: `worker-${label}`,
      name: "Worker",
      agentId,
      now: NOW,
    }),
  );
  return { officeWorkerId, agentVersionId };
}

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

  it("M22.2C projects operational inbox items with auth, ack and pagination", async () => {
    await bootstrapOrganization();
    const office = new PostgresOfficeRepository(database);
    const runs = new PostgresRunRepository(database);
    const artifacts = new PostgresArtifactRepository(database);

    const { approvalRequestId, workflowRunId } = await seedPendingApproval(
      database,
      WS_A,
      "m22c-a",
    );
    const approvalInboxId = inboxItemIdForApproval(approvalRequestId);

    const { officeWorkerId, agentVersionId } = await seedOfficeAssignmentGraph(
      database,
      WS_A,
      "m22c-a",
    );
    const failedAssignmentId = "asn-failed-m22c" as AssignmentId;
    const cancelledAssignmentId = "asn-cancelled-m22c" as AssignmentId;
    const failedRunId = "run-failed-m22c" as RunId;
    const deliverRunId = "run-deliver-m22c" as RunId;
    const deliverAttemptId = "run-attempt-deliver-m22c" as RunAttemptId;
    const modelProfileVersionId =
      "model-profile-version-m22c" as ModelProfileVersionId;

    await runs.saveRun(
      Run.create({
        id: failedRunId,
        workspaceId: WS_A,
        agentId: `agent-m22c-a` as AgentId,
        effectiveBindings: createBindings(
          agentVersionId,
          modelProfileVersionId,
        ),
        input: { prompt: "fail" },
        createdAt: NOW,
      }),
    );
    await runs.saveRun(
      Run.create({
        id: deliverRunId,
        workspaceId: WS_A,
        agentId: `agent-m22c-a` as AgentId,
        effectiveBindings: createBindings(
          agentVersionId,
          modelProfileVersionId,
        ),
        input: { prompt: "deliver" },
        createdAt: NOW,
      }),
    );
    await runs.saveRunAttempt(
      RunAttempt.createFirst({
        id: deliverAttemptId,
        runId: deliverRunId,
        createdAt: NOW,
      }),
    );

    await office.saveAssignment(
      Assignment.create({
        id: failedAssignmentId,
        workspaceId: WS_A,
        officeWorkerId,
        title: "Failed research",
        targetType: "AGENT_VERSION",
        targetVersionId: agentVersionId,
        input: {},
        now: NOW,
      })
        .markLaunched({ now: NOW, runId: failedRunId })
        .transitionTo("FAILED", { now: NOW, completedAt: NOW }),
    );
    await office.saveAssignment(
      Assignment.create({
        id: cancelledAssignmentId,
        workspaceId: WS_A,
        officeWorkerId,
        title: "Cancelled draft",
        targetType: "AGENT_VERSION",
        targetVersionId: agentVersionId,
        input: {},
        now: NOW,
      }).cancel(NOW),
    );

    const deliverableArtifactId = "artifact-m22c" as ArtifactId;
    await office.saveAssignment(
      Assignment.create({
        id: "asn-complete-m22c" as AssignmentId,
        workspaceId: WS_A,
        officeWorkerId,
        title: "Completed report",
        targetType: "AGENT_VERSION",
        targetVersionId: agentVersionId,
        input: {},
        now: NOW,
      })
        .markLaunched({ now: NOW, runId: deliverRunId })
        .transitionTo("COMPLETED", { now: NOW, completedAt: NOW }),
    );
    await artifacts.save(
      Artifact.create({
        id: deliverableArtifactId,
        workspaceId: WS_A,
        name: "report.md",
        mediaType: "text/markdown",
        sizeBytes: 64,
        digest: `sha256:${"d".repeat(64)}`,
        metadata: { source: "acceptance" },
        producerRunId: deliverRunId,
        producerRunAttemptId: deliverAttemptId,
        createdAt: NOW,
      }),
    );

    const { approvalRequestId: wsBApprovalId } = await seedPendingApproval(
      database,
      WS_B,
      "m22c-b",
    );
    const wsBApprovalInboxId = inboxItemIdForApproval(wsBApprovalId);

    await withWeb(async (origin) => {
      await completeOwnerSetup(origin);
      const ownerCookie = await login(origin, OWNER_EMAIL);
      const ownerHeaders = humanHeaders(origin, ownerCookie, WS_A);

      async function provisionHuman(
        email: string,
        workspaceId: WorkspaceId,
        role: (typeof HUMAN_WORKSPACE_ROLES)[keyof typeof HUMAN_WORKSPACE_ROLES],
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
            body: { email, displayName: email, role },
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

      await provisionHuman(MEMBER_EMAIL, WS_A, HUMAN_WORKSPACE_ROLES.DEVELOPER);
      await provisionHuman(VIEWER_EMAIL, WS_A, HUMAN_WORKSPACE_ROLES.VIEWER);
      await provisionHuman(
        OPERATOR_EMAIL,
        WS_A,
        HUMAN_WORKSPACE_ROLES.OPERATOR,
      );
      await provisionHuman(
        ISOLATED_B_EMAIL,
        WS_B,
        HUMAN_WORKSPACE_ROLES.DEVELOPER,
      );

      const memberCookie = await login(origin, MEMBER_EMAIL);
      const memberHeaders = humanHeaders(origin, memberCookie, WS_A);
      const viewerCookie = await login(origin, VIEWER_EMAIL);
      const viewerHeaders = humanHeaders(origin, viewerCookie, WS_A);
      const operatorCookie = await login(origin, OPERATOR_EMAIL);
      const operatorHeaders = humanHeaders(origin, operatorCookie, WS_A);
      const isolatedBCookie = await login(origin, ISOLATED_B_EMAIL);
      const isolatedBHeaders = humanHeaders(origin, isolatedBCookie, WS_B);

      const chatThread = await requestJson(origin, "/v1/office/threads", {
        method: "POST",
        headers: { ...ownerHeaders, "content-type": "application/json" },
        body: { title: "Ops channel" },
      });
      expect(chatThread.status).toBe(201);
      const threadId = (chatThread.body as { id: OfficeThreadId }).id;
      const ownerMessage = await requestJson(
        origin,
        `/v1/office/threads/${threadId}/messages`,
        {
          method: "POST",
          headers: { ...ownerHeaders, "content-type": "application/json" },
          body: { body: "Status update for inbox mix" },
        },
      );
      expect(ownerMessage.status).toBe(201);

      const memberInbox = await requestJson(origin, "/v1/office/inbox", {
        headers: memberHeaders,
      });
      expect(memberInbox.status).toBe(200);
      const items = inboxItems(memberInbox.body);
      const approvalItem = items.find((item) => item.id === approvalInboxId);
      expect(approvalItem).toMatchObject({
        kind: "APPROVAL_PENDING",
        approvalRequestId,
        workflowRunId,
      });

      const failedInboxId = inboxItemIdForAssignmentUpdate(
        failedAssignmentId,
        "FAILED",
      );
      const cancelledInboxId = inboxItemIdForAssignmentUpdate(
        cancelledAssignmentId,
        "CANCELLED",
      );
      const deliverableInboxId = inboxItemIdForDeliverable(
        deliverableArtifactId,
      );
      expect(items.some((item) => item.id === failedInboxId)).toBe(true);
      expect(items.some((item) => item.id === cancelledInboxId)).toBe(true);
      expect(
        items.some(
          (item) =>
            item.id === deliverableInboxId &&
            item.artifactId === deliverableArtifactId,
        ),
      ).toBe(true);

      const viewerInbox = await requestJson(origin, "/v1/office/inbox", {
        headers: viewerHeaders,
      });
      expect(viewerInbox.status).toBe(200);

      const viewerAckDenied = await requestJson(
        origin,
        "/v1/office/inbox/read-state",
        {
          method: "PATCH",
          headers: { ...viewerHeaders, "content-type": "application/json" },
          body: { itemId: failedInboxId },
        },
      );
      expect(viewerAckDenied.status).toBe(403);

      const operatorAckDenied = await requestJson(
        origin,
        "/v1/office/inbox/read-state",
        {
          method: "PATCH",
          headers: { ...operatorHeaders, "content-type": "application/json" },
          body: { itemId: failedInboxId },
        },
      );
      expect(operatorAckDenied.status).toBe(403);

      const operatorDecision = await requestJson(
        origin,
        `/v1/approval-requests/${approvalRequestId}/decision`,
        {
          method: "POST",
          headers: { ...operatorHeaders, "content-type": "application/json" },
          body: { decision: "APPROVED", comment: "Ship it" },
        },
      );
      expect(operatorDecision.status).toBe(200);

      const viewerDecisionDenied = await requestJson(
        origin,
        `/v1/approval-requests/${approvalRequestId}/decision`,
        {
          method: "POST",
          headers: { ...viewerHeaders, "content-type": "application/json" },
          body: { decision: "REJECTED" },
        },
      );
      expect(viewerDecisionDenied.status).toBe(403);

      const crossWorkspaceAck = await requestJson(
        origin,
        "/v1/office/inbox/read-state",
        {
          method: "PATCH",
          headers: { ...memberHeaders, "content-type": "application/json" },
          body: { itemId: wsBApprovalInboxId },
        },
      );
      expect(crossWorkspaceAck.status).toBe(403);
      const foreignReadStates = await database.sql<{ count: number }[]>`
        SELECT COUNT(*)::int AS count
        FROM office_inbox_item_read_states
        WHERE workspace_id = ${WS_B}
      `;
      expect(foreignReadStates[0]?.count).toBe(0);

      const memberAck = await requestJson(
        origin,
        "/v1/office/inbox/read-state",
        {
          method: "PATCH",
          headers: { ...memberHeaders, "content-type": "application/json" },
          body: { itemId: failedInboxId },
        },
      );
      expect(memberAck.status).toBe(200);
      expect((memberAck.body as { itemId: string }).itemId).toBe(failedInboxId);

      const memberAfterAck = await requestJson(origin, "/v1/office/inbox", {
        headers: memberHeaders,
      });
      expect(
        inboxItems(memberAfterAck.body).some(
          (item) => item.id === failedInboxId,
        ),
      ).toBe(false);

      const ownerStillSeesFailed = await requestJson(
        origin,
        "/v1/office/inbox",
        {
          headers: ownerHeaders,
        },
      );
      expect(
        inboxItems(ownerStillSeesFailed.body).some(
          (item) => item.id === failedInboxId,
        ),
      ).toBe(true);

      const pageOne = await requestJson(origin, "/v1/office/inbox?limit=2", {
        headers: memberHeaders,
      });
      expect(pageOne.status).toBe(200);
      const pageOneItems = inboxItems(pageOne.body);
      expect(pageOneItems.length).toBe(2);
      const nextCursor = (pageOne.body as { nextCursor?: string }).nextCursor;
      expect(nextCursor).toBeDefined();

      const pageTwo = await requestJson(
        origin,
        `/v1/office/inbox?limit=2&cursor=${encodeURIComponent(nextCursor!)}`,
        { headers: memberHeaders },
      );
      expect(pageTwo.status).toBe(200);
      const pageTwoItems = inboxItems(pageTwo.body);
      const allIds = [...pageOneItems, ...pageTwoItems].map((item) => item.id);
      expect(new Set(allIds).size).toBe(allIds.length);

      const wsBInbox = await requestJson(origin, "/v1/office/inbox", {
        headers: isolatedBHeaders,
      });
      expect(wsBInbox.status).toBe(200);
      expect(
        inboxItems(wsBInbox.body).some(
          (item) => item.id === wsBApprovalInboxId,
        ),
      ).toBe(true);
      void workflowRunId;
    });
  }, 180_000);

  it("M22.4D links approval inbox items to the office assignment when workflowRun is unique", async () => {
    await bootstrapOrganization();
    const office = new PostgresOfficeRepository(database);

    const { approvalRequestId, workflowRunId } = await seedPendingApproval(
      database,
      WS_A,
      "m224-inbox",
    );
    const { officeWorkerId } = await seedOfficeAssignmentGraph(
      database,
      WS_A,
      "m224-inbox",
    );
    const assignmentId = "asn-m224-inbox" as AssignmentId;
    await office.saveAssignment(
      Assignment.create({
        id: assignmentId,
        workspaceId: WS_A,
        officeWorkerId,
        title: "Workflow task",
        targetType: "WORKFLOW_VERSION",
        targetVersionId: "workflow-version-m224-inbox" as WorkflowVersionId,
        input: {},
        now: NOW,
      }).markLaunched({ workflowRunId, now: NOW }),
    );

    await withWeb(async (origin) => {
      await completeOwnerSetup(origin);
      const ownerCookie = await login(origin, OWNER_EMAIL);
      const ownerHeaders = humanHeaders(origin, ownerCookie, WS_A);

      const inbox = await requestJson(origin, "/v1/office/inbox", {
        headers: ownerHeaders,
      });
      expect(inbox.status).toBe(200);
      const approvalItem = inboxItems(inbox.body).find(
        (item) => item.id === inboxItemIdForApproval(approvalRequestId),
      );
      expect(approvalItem).toMatchObject({
        kind: "APPROVAL_PENDING",
        approvalRequestId,
        workflowRunId,
        assignmentId,
      });
    });
  }, 120_000);
});
