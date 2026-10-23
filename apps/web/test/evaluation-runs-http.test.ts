import type {
  EvaluationQualityGatePolicyV1,
  EvaluationRunId,
  WorkspaceId,
} from "@osva-ai/contracts";
import { EVALUATION_QUALITY_GATE_POLICY_SCHEMA_VERSION } from "@osva-ai/contracts";
import {
  EvaluationRun,
  EvaluationRunGateAssessment,
  assessEvaluationQualityGate,
} from "@osva/domain";
import { afterEach, describe, expect, it } from "vitest";

import { closeHttpServer, listenHttpServer } from "../src/server.js";
import {
  authHeadersForKey,
  fetchJson,
  setTestAuthHeaders,
} from "./http-test-helpers.js";
import { TEST_NOW, createTestWebApplication } from "./test-web.js";
import {
  WS_B,
  createTwoWorkspaceHarness,
  expectNotFound,
  fetchV1,
} from "./two-workspace-harness.js";
import { seedWorkspaceBFixtures } from "./seed-workspace-b-fixtures.js";

const WORKSPACE_ID = "ws-eval-http" as WorkspaceId;

const VALID_MANIFEST = {
  schemaVersion: "1",
  key: "eval-agent",
  name: "Eval Agent",
  runtime: { type: "BUILTIN_PACKAGE", key: "eval-agent" },
  input: { schema: {} },
  output: { schema: {} },
  execution: { timeoutMs: 30_000, maxAttempts: 2 },
  capabilities: { model: false, tools: [] },
};

const VALID_GATE_POLICY: EvaluationQualityGatePolicyV1 = {
  schemaVersion: EVALUATION_QUALITY_GATE_POLICY_SCHEMA_VERSION,
  rules: [{ metric: "PASS_RATE", operator: "MIN", threshold: 0 }],
};

describe("Evaluation runs HTTP API", () => {
  const servers: import("node:http").Server[] = [];

  afterEach(async () => {
    await Promise.all(
      servers.splice(0).map((server) => closeHttpServer(server)),
    );
  });

  it("accepts valid qualityGatePolicy on POST and rejects invalid policies", async () => {
    const { origin } = await listen();
    const { agentVersionId, evaluationSuiteVersionId } =
      await seedEvaluationLaunchFixtures(origin);

    const valid = await fetchJson(`${origin}/v1/evaluation-runs`, {
      method: "POST",
      body: {
        evaluationSuiteVersionId,
        targetType: "AGENT_VERSION",
        targetVersionId: agentVersionId,
        qualityGatePolicy: VALID_GATE_POLICY,
      },
    });
    expect(valid.status).toBe(201);
    expect(valid.body).toMatchObject({
      qualityGate: {
        policy: VALID_GATE_POLICY,
      },
    });
    const validAssessment = (
      valid.body as {
        qualityGate?: { assessment?: { overallVerdict?: string } };
      }
    ).qualityGate?.assessment;
    expect(validAssessment?.overallVerdict).not.toBe("PASS");

    const invalidMetric = await fetchJson(`${origin}/v1/evaluation-runs`, {
      method: "POST",
      body: {
        evaluationSuiteVersionId,
        targetType: "AGENT_VERSION",
        targetVersionId: agentVersionId,
        qualityGatePolicy: {
          schemaVersion: 1,
          rules: [{ metric: "UNKNOWN", operator: "MIN", threshold: 0.5 }],
        },
      },
    });
    expect(invalidMetric.status).toBe(400);

    const invalidThreshold = await fetchJson(`${origin}/v1/evaluation-runs`, {
      method: "POST",
      body: {
        evaluationSuiteVersionId,
        targetType: "AGENT_VERSION",
        targetVersionId: agentVersionId,
        qualityGatePolicy: {
          schemaVersion: 1,
          rules: [{ metric: "PASS_RATE", operator: "MIN", threshold: 2 }],
        },
      },
    });
    expect(invalidThreshold.status).toBe(400);

    const duplicateRules = await fetchJson(`${origin}/v1/evaluation-runs`, {
      method: "POST",
      body: {
        evaluationSuiteVersionId,
        targetType: "AGENT_VERSION",
        targetVersionId: agentVersionId,
        qualityGatePolicy: {
          schemaVersion: 1,
          rules: [
            { metric: "PASS_RATE", operator: "MIN", threshold: 0.5 },
            { metric: "PASS_RATE", operator: "MIN", threshold: 0.8 },
          ],
        },
      },
    });
    expect(duplicateRules.status).toBe(400);
  });

  it("does not return final PASS for nonterminal gated GET", async () => {
    const { origin } = await listen();
    const { agentVersionId, evaluationSuiteVersionId } =
      await seedEvaluationLaunchFixtures(origin);

    const launched = await fetchJson(`${origin}/v1/evaluation-runs`, {
      method: "POST",
      body: {
        evaluationSuiteVersionId,
        targetType: "AGENT_VERSION",
        targetVersionId: agentVersionId,
        qualityGatePolicy: VALID_GATE_POLICY,
      },
    });
    expect(launched.status).toBe(201);
    const runId = (launched.body as { id: string }).id;

    const detail = await fetchJson(`${origin}/v1/evaluation-runs/${runId}`);
    expect(detail.status).toBe(200);
    expect(detail.body).toMatchObject({
      status: "RUNNING",
      qualityGate: {
        policy: VALID_GATE_POLICY,
      },
    });
    expect(
      (
        detail.body as {
          qualityGate: { assessment: { overallVerdict: string } };
        }
      ).qualityGate.assessment.overallVerdict,
    ).not.toBe("PASS");
  });

  it("omits qualityGate on GET when no policy was configured", async () => {
    const { origin, ctx } = await listen();
    const { agentVersionId, evaluationSuiteVersionId } =
      await seedEvaluationLaunchFixtures(origin);

    const launched = await fetchJson(`${origin}/v1/evaluation-runs`, {
      method: "POST",
      body: {
        evaluationSuiteVersionId,
        targetType: "AGENT_VERSION",
        targetVersionId: agentVersionId,
      },
    });
    expect(launched.status).toBe(201);
    const runId = (launched.body as { id: string }).id;

    const detail = await fetchJson(`${origin}/v1/evaluation-runs/${runId}`);
    expect(detail.status).toBe(200);
    expect(detail.body).not.toHaveProperty("qualityGate");

    const stored = await ctx.evaluationSuites.findEvaluationRunById(
      runId as EvaluationRunId,
    );
    expect(stored?.qualityGatePolicy).toBeUndefined();
  });

  it("returns persisted assessment on GET for terminal gated runs", async () => {
    const { origin, ctx } = await listen();
    const { agentVersionId, evaluationSuiteVersionId } =
      await seedEvaluationLaunchFixtures(origin);

    const launched = await fetchJson(`${origin}/v1/evaluation-runs`, {
      method: "POST",
      body: {
        evaluationSuiteVersionId,
        targetType: "AGENT_VERSION",
        targetVersionId: agentVersionId,
        qualityGatePolicy: VALID_GATE_POLICY,
      },
    });
    const runId = (launched.body as { id: string }).id as EvaluationRunId;

    const stored = await ctx.evaluationSuites.findEvaluationRunById(runId);
    expect(stored).not.toBeNull();
    const completed = stored!.transitionTo("COMPLETED", {
      updatedAt: TEST_NOW,
      completedAt: TEST_NOW,
    });
    await ctx.evaluationSuites.transitionEvaluationRun(
      stored!.status,
      completed,
    );

    const assessment = assessEvaluationQualityGate({
      policy: VALID_GATE_POLICY,
      evaluationRunStatus: "COMPLETED",
      summary: (
        launched.body as {
          summary: Parameters<typeof assessEvaluationQualityGate>[0]["summary"];
        }
      ).summary,
      assessedAt: TEST_NOW,
      allowFinalPass: true,
    });
    await ctx.evaluationSuites.saveGateAssessment(
      EvaluationRunGateAssessment.create({
        evaluationRunId: runId,
        workspaceId: WORKSPACE_ID,
        policySnapshot: VALID_GATE_POLICY,
        assessment,
      }),
    );

    const detail = await fetchJson(`${origin}/v1/evaluation-runs/${runId}`);
    expect(detail.status).toBe(200);
    expect(detail.body).toMatchObject({
      qualityGate: {
        policy: VALID_GATE_POLICY,
        assessment: {
          overallVerdict: assessment.overallVerdict,
          lifecycleVerdict: assessment.lifecycleVerdict,
        },
      },
    });
  });

  it("does not disclose gated runs across workspaces", async () => {
    const harness = await createTwoWorkspaceHarness(servers);
    const b = await seedWorkspaceBFixtures(harness.ctx);

    const gatePolicy: EvaluationQualityGatePolicyV1 = {
      schemaVersion: EVALUATION_QUALITY_GATE_POLICY_SCHEMA_VERSION,
      rules: [{ metric: "PASS_RATE", operator: "MIN", threshold: 0 }],
    };
    const existing = await harness.ctx.evaluationSuites.findEvaluationRunById(
      b.evaluationRunId,
    );
    expect(existing).not.toBeNull();
    const withGate = EvaluationRun.rehydrate({
      id: existing!.id,
      workspaceId: existing!.workspaceId,
      evaluationSuiteVersionId: existing!.evaluationSuiteVersionId,
      targetType: existing!.targetType,
      targetVersionId: existing!.targetVersionId,
      qualityGatePolicy: gatePolicy,
      status: existing!.status,
      createdAt: existing!.createdAt,
      updatedAt: existing!.updatedAt,
    });
    await harness.ctx.evaluationSuites.saveEvaluationRun(withGate);
    const running = withGate.transitionTo("RUNNING", {
      updatedAt: TEST_NOW,
      startedAt: TEST_NOW,
    });
    await harness.ctx.evaluationSuites.transitionEvaluationRun(
      withGate.status,
      running,
    );
    const completed = running.transitionTo("COMPLETED", {
      updatedAt: TEST_NOW,
      completedAt: TEST_NOW,
    });
    await harness.ctx.evaluationSuites.transitionEvaluationRun(
      running.status,
      completed,
    );
    await harness.ctx.evaluationSuites.saveGateAssessment(
      EvaluationRunGateAssessment.create({
        evaluationRunId: b.evaluationRunId,
        workspaceId: WS_B,
        policySnapshot: gatePolicy,
        assessment: assessEvaluationQualityGate({
          policy: gatePolicy,
          evaluationRunStatus: "COMPLETED",
          summary: {
            totalCases: 1,
            pendingCases: 0,
            runningCases: 0,
            completedCases: 1,
            passedCases: 1,
            failedCases: 0,
            errorCases: 0,
            passRate: 1,
            completionCoverage: 1,
            validScoredCaseCount: 1,
            inputTokens: 0,
            outputTokens: 0,
            pricedCostUsdMicros: 0,
            unpricedModelCalls: 0,
            usageMeasured: false,
          },
          assessedAt: TEST_NOW,
          allowFinalPass: true,
        }),
      }),
    );

    const foreign = await fetchV1(
      `${harness.origin}/v1/evaluation-runs/${b.evaluationRunId}`,
      { headers: harness.authA },
    );
    expectNotFound(foreign);
    expect(JSON.stringify(foreign.body)).not.toContain("qualityGate");
  });

  async function listen() {
    const ctx = await createTestWebApplication({ workspaceId: WORKSPACE_ID });
    servers.push(ctx.server);
    const port = await listenHttpServer(ctx.server, "127.0.0.1", 0);
    setTestAuthHeaders(ctx.testApiKey);
    return {
      origin: `http://127.0.0.1:${String(port)}`,
      authHeaders: authHeadersForKey(ctx.testApiKey),
      ctx,
    };
  }

  async function seedEvaluationLaunchFixtures(origin: string) {
    const agent = await fetchJson(`${origin}/v1/agents`, {
      method: "POST",
      body: { key: "eval-agent", name: "Eval Agent" },
    });
    const agentId = (agent.body as { id: string }).id;
    const version = await fetchJson(`${origin}/v1/agents/${agentId}/versions`, {
      method: "POST",
      body: { manifest: VALID_MANIFEST },
    });
    const agentVersionId = (version.body as { id: string }).id;

    const suite = await fetchJson(`${origin}/v1/evaluation-suites`, {
      method: "POST",
      body: { key: "eval-suite", name: "Eval Suite" },
    });
    const suiteId = (suite.body as { id: string }).id;
    const suiteVersion = await fetchJson(
      `${origin}/v1/evaluation-suites/${suiteId}/versions`,
      {
        method: "POST",
        body: {
          cases: [
            {
              key: "case-1",
              input: { prompt: "x" },
              evaluator: {
                type: "JSON_EXACT_MATCH",
                expected: { prompt: "x" },
              },
            },
          ],
        },
      },
    );

    return {
      agentVersionId,
      evaluationSuiteVersionId: (suiteVersion.body as { id: string }).id,
    };
  }
});
