import {
  AUTHENTICATION_METHODS,
  EVALUATION_COMPARISON_POLICY_SCHEMA_VERSION,
  HUMAN_WORKSPACE_ROLES,
  OSVA_WORKSPACE_ID_HEADER,
  PUBLIC_API_ERROR_CODES,
  SECURITY_AUDIT_EVENT_TYPES,
  USER_STATUSES,
  type EvaluationCaseId,
  type EvaluationComparisonId,
  type EvaluationRunId,
  type UserId,
  type WorkspaceId,
  type WorkspaceMembershipId,
} from "@osva-ai/contracts";
import {
  SecurityAuditEvent,
  User,
  WorkspaceMembership,
  type SecurityAuditEventRepository,
} from "@osva/domain";
import type { IncomingMessage } from "node:http";
import { afterEach, describe, expect, it } from "vitest";

import { lookupV1RouteAccess } from "../src/v1-route-human-access-inventory.js";
import { V1_ROUTE_INVENTORY } from "../src/v1-route-inventory.js";
import { inferV1RouteAuthorizationAction } from "../src/v1-route-authorization-policy.js";
import { structuralKeyFromInventoryRoute } from "../src/v1-route-structural-key.js";
import { TEST_NOW } from "./test-web.js";
import {
  WS_A,
  WS_B,
  closeServers,
  createTwoWorkspaceHarness,
  expectNotFound,
  expectV1Error,
  fetchV1,
} from "./two-workspace-harness.js";

const TRUSTED_ORIGIN = "http://127.0.0.1:4174";
const DEV_USER = "user-eval-cmp-dev" as UserId;
const VIEWER_USER = "user-eval-cmp-viewer" as UserId;
const OPERATOR_USER = "user-eval-cmp-operator" as UserId;

const VALID_POLICY = {
  schemaVersion: EVALUATION_COMPARISON_POLICY_SCHEMA_VERSION,
  minComparisonCoverage: 0,
  minValidScoredPairs: 1,
  maxMeanPairedScoreRegression: 1,
  maxPerCaseScoreRegression: 1,
  maxNewlyFailingCriticalCases: 0,
  maxNewEvaluatorErrors: 0,
};

const VALID_MANIFEST = {
  schemaVersion: "1",
  key: "cmp-agent",
  name: "Cmp Agent",
  runtime: { type: "BUILTIN_PACKAGE", key: "cmp-agent" },
  input: { schema: {} },
  output: { schema: {} },
  execution: { timeoutMs: 30_000, maxAttempts: 2 },
  capabilities: { model: false, tools: [] },
};

class MemorySecurityAuditEventRepository implements SecurityAuditEventRepository {
  readonly events: SecurityAuditEvent[] = [];

  async append(event: SecurityAuditEvent): Promise<void> {
    this.events.push(event);
  }

  async listForWorkspace(
    workspaceId: WorkspaceId,
    limit: number,
  ): Promise<readonly SecurityAuditEvent[]> {
    return this.events
      .filter((event) => event.workspaceId === workspaceId)
      .slice(0, limit);
  }
}

const SESSION_USERS: Record<
  string,
  {
    readonly userId: UserId;
    readonly role: (typeof HUMAN_WORKSPACE_ROLES)[keyof typeof HUMAN_WORKSPACE_ROLES];
  }
> = {
  "sess-dev": { userId: DEV_USER, role: HUMAN_WORKSPACE_ROLES.DEVELOPER },
  "sess-viewer": { userId: VIEWER_USER, role: HUMAN_WORKSPACE_ROLES.VIEWER },
  "sess-operator": {
    userId: OPERATOR_USER,
    role: HUMAN_WORKSPACE_ROLES.OPERATOR,
  },
};

function multiHumanAuthServices(workspaceId: WorkspaceId) {
  const users = new Map(
    Object.values(SESSION_USERS).map((entry) => [
      entry.userId,
      User.create({
        id: entry.userId,
        email: `${entry.userId}@example.com`,
        displayName: "Human",
        status: USER_STATUSES.ACTIVE,
        createdAt: TEST_NOW,
      }),
    ]),
  );
  const memberships = new Map(
    Object.values(SESSION_USERS).map((entry) => [
      entry.userId,
      WorkspaceMembership.create({
        id: `wm-${entry.userId}` as WorkspaceMembershipId,
        workspaceId,
        userId: entry.userId,
        role: entry.role,
        createdAt: TEST_NOW,
      }),
    ]),
  );
  return {
    trustedOrigins: [TRUSTED_ORIGIN],
    humanAuthentication: {
      async signOut() {},
      async getSession(token: string) {
        const entry = SESSION_USERS[token];
        return entry === undefined
          ? null
          : { userId: entry.userId, sessionId: token };
      },
    },
    users: {
      async save() {},
      async findById(id: UserId) {
        return users.get(id) ?? null;
      },
      async findByEmail() {
        return users.values().next().value ?? null;
      },
    },
    workspaceMemberships: {
      async save() {},
      async findById() {
        return null;
      },
      async findByWorkspaceAndUser(wid: WorkspaceId, uid: UserId) {
        return wid === workspaceId ? (memberships.get(uid) ?? null) : null;
      },
      async listByWorkspaceId() {
        return [];
      },
      async listByUserId(uid: UserId) {
        const membership = memberships.get(uid);
        return membership === undefined ? [] : [membership];
      },
      async countByWorkspaceAndRole() {
        return 0;
      },
    },
  } as unknown as import("../src/human-auth-http.js").HumanAuthHttpServices;
}

function authenticateSessionFromCookie(
  request: IncomingMessage,
): import("@osva-ai/contracts").HumanSessionRequestPrincipal | null {
  const cookie = request.headers.cookie ?? "";
  const token = cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith("osva.session_token="))
    ?.slice("osva.session_token=".length);
  if (token === undefined) {
    return null;
  }
  const entry = SESSION_USERS[token];
  if (entry === undefined) {
    return null;
  }
  return {
    authenticationMethod: AUTHENTICATION_METHODS.HUMAN_SESSION,
    userId: entry.userId,
    sessionId: token,
    workspaceId: WS_A,
    humanRole: entry.role,
  };
}

function sessionHeaders(
  userId: UserId,
  token: string,
  workspaceId: WorkspaceId,
) {
  return {
    cookie: `osva.session_token=${token}`,
    [OSVA_WORKSPACE_ID_HEADER]: workspaceId,
    origin: TRUSTED_ORIGIN,
  };
}

describe("evaluation comparisons HTTP security", () => {
  const servers: import("node:http").Server[] = [];

  afterEach(async () => {
    await closeServers(servers);
  });

  async function seedSuiteAndTerminalRuns(
    harness: Awaited<ReturnType<typeof createTwoWorkspaceHarness>>,
    authHeaders: Record<string, string>,
  ) {
    const agent = await fetchV1(`${harness.origin}/v1/agents`, {
      method: "POST",
      headers: authHeaders,
      body: { key: "cmp-agent", name: "Cmp Agent" },
    });
    const agentId = (agent.body as { id: string }).id;
    const version = await fetchV1(
      `${harness.origin}/v1/agents/${agentId}/versions`,
      {
        method: "POST",
        headers: authHeaders,
        body: { manifest: VALID_MANIFEST },
      },
    );
    const agentVersionId = (version.body as { id: string }).id;
    const suite = await fetchV1(`${harness.origin}/v1/evaluation-suites`, {
      method: "POST",
      headers: authHeaders,
      body: { key: "cmp-suite", name: "Cmp Suite" },
    });
    const suiteId = (suite.body as { id: string }).id;
    const suiteVersion = await fetchV1(
      `${harness.origin}/v1/evaluation-suites/${suiteId}/versions`,
      {
        method: "POST",
        headers: authHeaders,
        body: {
          cases: [
            {
              key: "case-1",
              input: { prompt: "x" },
              evaluator: {
                type: "JSON_EXACT_MATCH",
                expected: { answer: "y" },
              },
            },
          ],
        },
      },
    );
    const evaluationSuiteVersionId = (suiteVersion.body as { id: string }).id;
    const caseId = (suiteVersion.body as { cases: { id: string }[] }).cases[0]!
      .id as EvaluationCaseId;

    const launch = async (label: string) => {
      const created = await fetchV1(`${harness.origin}/v1/evaluation-runs`, {
        method: "POST",
        headers: authHeaders,
        body: {
          evaluationSuiteVersionId,
          targetType: "AGENT_VERSION",
          targetVersionId: agentVersionId,
        },
      });
      const runId = (created.body as { id: EvaluationRunId }).id;
      const run =
        await harness.ctx.evaluationSuites.findEvaluationRunById(runId);
      if (run === null) {
        throw new Error(`missing run ${label}`);
      }
      const completed = run.transitionTo("COMPLETED", {
        updatedAt: TEST_NOW,
        completedAt: TEST_NOW,
      });
      await harness.ctx.evaluationSuites.transitionEvaluationRun(
        run.status,
        completed,
      );
      return runId;
    };

    const baselineEvaluationRunId = await launch("baseline");
    const candidateEvaluationRunId = await launch("candidate");
    return {
      evaluationSuiteVersionId,
      baselineEvaluationRunId,
      candidateEvaluationRunId,
      caseId,
      agentVersionId,
      suiteId,
    };
  }

  async function createComparison(
    harness: Awaited<ReturnType<typeof createTwoWorkspaceHarness>>,
    authHeaders: Record<string, string>,
    body: Record<string, unknown>,
  ) {
    return fetchV1(`${harness.origin}/v1/evaluation-comparisons`, {
      method: "POST",
      headers: authHeaders,
      body,
    });
  }

  it("Group A–D: comparison access, human identity, CSRF, and response semantics", async () => {
    const audit = new MemorySecurityAuditEventRepository();
    const harness = await createTwoWorkspaceHarness(servers, {
      humanAuth: multiHumanAuthServices(WS_A),
      authenticateHumanSession: async (request: IncomingMessage) =>
        authenticateSessionFromCookie(request),
      securityAuditEvents: audit,
    });

    const fixtures = await seedSuiteAndTerminalRuns(harness, harness.authA);

    const apiCreate = await createComparison(harness, harness.authA, {
      baselineEvaluationRunId: fixtures.baselineEvaluationRunId,
      candidateEvaluationRunId: fixtures.candidateEvaluationRunId,
      policy: VALID_POLICY,
    });
    expect(apiCreate.status).toBe(201);
    const comparisonId = (apiCreate.body as { id: EvaluationComparisonId }).id;

    const humanHeaders = sessionHeaders(DEV_USER, "sess-dev", WS_A);
    const humanCreate = await createComparison(harness, humanHeaders, {
      baselineEvaluationRunId: fixtures.candidateEvaluationRunId,
      candidateEvaluationRunId: fixtures.baselineEvaluationRunId,
      policy: VALID_POLICY,
    });
    expect(humanCreate.status).toBe(201);

    const unauth = await fetchV1(
      `${harness.origin}/v1/evaluation-comparisons/${comparisonId}`,
    );
    expectV1Error(unauth, 401, PUBLIC_API_ERROR_CODES.AUTHENTICATION_REQUIRED);

    const crossRead = await fetchV1(
      `${harness.origin}/v1/evaluation-comparisons/${comparisonId}`,
      { headers: { ...harness.authB, [OSVA_WORKSPACE_ID_HEADER]: WS_B } },
    );
    expectNotFound(crossRead);

    const viewerDenied = await createComparison(
      harness,
      sessionHeaders(VIEWER_USER, "sess-viewer", WS_A),
      {
        baselineEvaluationRunId: fixtures.baselineEvaluationRunId,
        candidateEvaluationRunId: fixtures.candidateEvaluationRunId,
        policy: VALID_POLICY,
      },
    );
    expect(viewerDenied.status).toBe(403);

    const invalidPolicy = await createComparison(harness, harness.authA, {
      baselineEvaluationRunId: fixtures.baselineEvaluationRunId,
      candidateEvaluationRunId: fixtures.candidateEvaluationRunId,
      policy: { ...VALID_POLICY, schemaVersion: 99 },
    });
    expect(invalidPolicy.status).toBe(400);

    const versionTwo = await fetchV1(
      `${harness.origin}/v1/evaluation-suites/${fixtures.suiteId}/versions`,
      {
        method: "POST",
        headers: harness.authA,
        body: {
          cases: [
            {
              key: "case-2",
              input: { prompt: "z" },
              evaluator: {
                type: "JSON_EXACT_MATCH",
                expected: { answer: "z" },
              },
            },
          ],
        },
      },
    );
    const otherVersionId = (versionTwo.body as { id: string }).id;
    const otherRunCreated = await fetchV1(
      `${harness.origin}/v1/evaluation-runs`,
      {
        method: "POST",
        headers: harness.authA,
        body: {
          evaluationSuiteVersionId: otherVersionId,
          targetType: "AGENT_VERSION",
          targetVersionId: fixtures.agentVersionId,
        },
      },
    );
    const otherRunId = (otherRunCreated.body as { id: EvaluationRunId }).id;
    const otherRun =
      await harness.ctx.evaluationSuites.findEvaluationRunById(otherRunId);
    if (otherRun !== null) {
      const completedOther = otherRun.transitionTo("COMPLETED", {
        updatedAt: TEST_NOW,
        completedAt: TEST_NOW,
      });
      await harness.ctx.evaluationSuites.transitionEvaluationRun(
        otherRun.status,
        completedOther,
      );
    }
    const mismatchedSuite = await createComparison(harness, harness.authA, {
      baselineEvaluationRunId: fixtures.baselineEvaluationRunId,
      candidateEvaluationRunId: otherRunId,
      policy: VALID_POLICY,
    });
    expect(mismatchedSuite.status).toBe(400);

    const crossCreate = await createComparison(
      harness,
      {
        ...harness.authB,
        [OSVA_WORKSPACE_ID_HEADER]: WS_B,
      },
      {
        baselineEvaluationRunId: fixtures.baselineEvaluationRunId,
        candidateEvaluationRunId: fixtures.candidateEvaluationRunId,
        policy: VALID_POLICY,
      },
    );
    expectNotFound(crossCreate);

    const review = await fetchV1(
      `${harness.origin}/v1/evaluation-comparisons/${comparisonId}/human-reviews`,
      {
        method: "POST",
        headers: humanHeaders,
        body: {
          evaluationCaseId: fixtures.caseId,
          decision: "CANDIDATE_BETTER",
          rationale: "Clear improvement.",
        },
      },
    );
    expect(review.status).toBe(201);
    expect((review.body as { reviewerUserId: string }).reviewerUserId).toBe(
      DEV_USER,
    );

    const apiReview = await fetchV1(
      `${harness.origin}/v1/evaluation-comparisons/${comparisonId}/human-reviews`,
      {
        method: "POST",
        headers: harness.authA,
        body: {
          evaluationCaseId: fixtures.caseId,
          decision: "TIE",
        },
      },
    );
    expect(apiReview.status).toBe(403);

    const forgedBody = await fetchV1(
      `${harness.origin}/v1/evaluation-comparisons/${comparisonId}/human-reviews`,
      {
        method: "POST",
        headers: humanHeaders,
        body: {
          evaluationCaseId: fixtures.caseId,
          decision: "TIE",
          reviewerUserId: "forged-user",
        },
      },
    );
    expect(forgedBody.status).toBe(400);

    const operatorWriteDenied = await fetchV1(
      `${harness.origin}/v1/evaluation-comparisons/${comparisonId}/human-reviews`,
      {
        method: "POST",
        headers: sessionHeaders(OPERATOR_USER, "sess-operator", WS_A),
        body: {
          evaluationCaseId: fixtures.caseId,
          decision: "TIE",
        },
      },
    );
    expect(operatorWriteDenied.status).toBe(403);

    const missingSession = await fetchV1(
      `${harness.origin}/v1/evaluation-comparisons/${comparisonId}/human-reviews`,
      {
        method: "POST",
        headers: {
          [OSVA_WORKSPACE_ID_HEADER]: WS_A,
          origin: TRUSTED_ORIGIN,
        },
        body: {
          evaluationCaseId: fixtures.caseId,
          decision: "TIE",
        },
      },
    );
    expectV1Error(
      missingSession,
      401,
      PUBLIC_API_ERROR_CODES.AUTHENTICATION_REQUIRED,
    );

    const invalidCase = await fetchV1(
      `${harness.origin}/v1/evaluation-comparisons/${comparisonId}/human-reviews`,
      {
        method: "POST",
        headers: humanHeaders,
        body: {
          evaluationCaseId: "ec-not-in-suite",
          decision: "TIE",
        },
      },
    );
    expect(invalidCase.status).toBe(400);

    const noCsrf = await fetchV1(
      `${harness.origin}/v1/evaluation-comparisons/${comparisonId}/human-reviews`,
      {
        method: "POST",
        headers: {
          cookie: "osva.session_token=sess-dev",
          [OSVA_WORKSPACE_ID_HEADER]: WS_A,
        },
        body: {
          evaluationCaseId: fixtures.caseId,
          decision: "TIE",
        },
      },
    );
    expect(noCsrf.status).toBe(403);

    const badOrigin = await fetchV1(
      `${harness.origin}/v1/evaluation-comparisons/${comparisonId}/human-reviews`,
      {
        method: "POST",
        headers: {
          ...humanHeaders,
          origin: "https://evil.example",
        },
        body: {
          evaluationCaseId: fixtures.caseId,
          decision: "TIE",
        },
      },
    );
    expect(badOrigin.status).toBe(403);

    const apiPostNoCsrf = await createComparison(harness, harness.authA, {
      baselineEvaluationRunId: fixtures.baselineEvaluationRunId,
      candidateEvaluationRunId: fixtures.candidateEvaluationRunId,
      policy: VALID_POLICY,
    });
    expect(apiPostNoCsrf.status).toBe(201);

    const pairwise = await fetchV1(
      `${harness.origin}/v1/evaluation-comparisons/${comparisonId}/pairwise-results`,
      { headers: harness.authA },
    );
    expect(pairwise.status).toBe(200);

    const assessment = await fetchV1(
      `${harness.origin}/v1/evaluation-comparisons/${comparisonId}/assessment`,
      { headers: harness.authA },
    );
    expect(assessment.status).toBe(200);
    const promotion = (
      assessment.body as { promotion?: { recommendation?: string } }
    ).promotion;
    if (promotion?.recommendation !== undefined) {
      expect(promotion.recommendation).not.toBe("PROMOTE");
    }

    const calibration = await fetchV1(
      `${harness.origin}/v1/evaluation-comparisons/${comparisonId}/calibration`,
      { headers: harness.authA },
    );
    expect(calibration.status).toBe(200);
    expect(
      (calibration.body as { unavailableReason?: string }).unavailableReason,
    ).toBeDefined();

    const auditEvents = await audit.listForWorkspace(WS_A, 10);
    expect(auditEvents.length).toBeGreaterThan(0);
    const recorded = auditEvents.find(
      (event) =>
        event.eventType ===
        SECURITY_AUDIT_EVENT_TYPES.EVALUATION_COMPARISON_HUMAN_REVIEW_SUBMITTED,
    );
    expect(recorded?.details).toMatchObject({
      comparisonId,
      evaluationCaseId: fixtures.caseId,
    });
    expect(JSON.stringify(recorded?.details ?? {})).not.toMatch(
      /password|secret|credential/i,
    );

    const comparisonRoutes = V1_ROUTE_INVENTORY.filter((route) =>
      route.path.includes("evaluation-comparisons"),
    );
    expect(comparisonRoutes.length).toBe(8);
    for (const route of comparisonRoutes) {
      const access = lookupV1RouteAccess(route.method, route.path);
      expect(access?.resourceFamily).toBe("evaluation");
      const key = structuralKeyFromInventoryRoute(route);
      expect(inferV1RouteAuthorizationAction(route.method, key)).toBeDefined();
    }
  });
});
