/**
 * B5.4C judge worker-path acceptance (J1–J3, J7) — Postgres admission + judge invoker stack.
 */
import type {
  EvaluationJudgeTaskId,
  InferenceBudgetPolicyId,
  InferenceBudgetPolicyVersionId,
  ModelProfileId,
  ModelProfileVersionId,
  WorkspaceId,
} from "@osva-ai/contracts";
import {
  INFERENCE_INVOCATION_ANCHOR_FORMAT_VERSION,
  MODEL_ERROR_CODES,
} from "@osva-ai/contracts";
import {
  ModelProfile,
  Workspace,
  buildInferenceInvocationAnchorString,
} from "@osva/domain";
import { BudgetEnforcingModelGateway } from "@osva/model-gateway";
import { resolveEvaluationJudgeBudgetContext } from "@osva/observability";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  createDatabase,
  migrateDatabase,
  PostgresInferenceBudgetAdmissionRepository,
  PostgresInferenceBudgetPolicyRepository,
  PostgresModelProfileRepository,
  PostgresWorkspaceRepository,
  type Database,
} from "@osva/db";
import {
  resetStage0Tables,
  startPostgresForTests,
  stopPostgresForTests,
  type PostgresTestContext,
} from "../../../../packages/db/test/integration/postgres-harness.js";
import { createEvaluationJudgeModelInvoker } from "../../src/evaluation-judge-model-invoker.js";

const WORKSPACE = "ws-judge-b54c" as WorkspaceId;
const PROFILE_ID = "mp-judge" as ModelProfileId;
const PROFILE_V = "mpv-judge" as ModelProfileVersionId;
const NOW = new Date("2026-04-10T12:00:00.000Z");

describe("B5.4C judge worker stack", () => {
  let postgres: PostgresTestContext;
  let database: Database;
  let workspaces: PostgresWorkspaceRepository;
  let policies: PostgresInferenceBudgetPolicyRepository;
  let admission: PostgresInferenceBudgetAdmissionRepository;
  let modelProfiles: PostgresModelProfileRepository;

  beforeAll(async () => {
    postgres = await startPostgresForTests();
    database = createDatabase({
      connectionString: postgres.connectionString,
      max: 4,
      connectTimeoutSeconds: 10,
    });
    await migrateDatabase(database);
    workspaces = new PostgresWorkspaceRepository(database);
    policies = new PostgresInferenceBudgetPolicyRepository(database);
    admission = new PostgresInferenceBudgetAdmissionRepository(database);
    modelProfiles = new PostgresModelProfileRepository(database);
  });

  beforeEach(async () => {
    await resetStage0Tables(database);
    await workspaces.save(
      Workspace.create({ id: WORKSPACE, name: "Judge", createdAt: NOW }),
    );
    const policyId = "ibp-judge" as InferenceBudgetPolicyId;
    await policies.savePolicy({
      id: policyId,
      workspaceId: WORKSPACE,
      key: "default",
      createdAt: NOW,
    });
    const versionId = "ibpv-judge" as InferenceBudgetPolicyVersionId;
    await policies.savePolicyVersion({
      id: versionId,
      policyId,
      workspaceId: WORKSPACE,
      version: 1,
      definition: {
        schemaVersion: "1",
        periodKind: "CALENDAR_MONTH_UTC",
        periodLimitUsdMicros: 5_000_000,
        periodEnforcement: "STRICT_PERIOD_CAP",
        unknownAdmitCostBehavior: "DENY_ADMISSION",
        onLeaseLoss: "RECONCILIATION_REQUIRED",
      },
      createdAt: NOW,
    });
    await policies.upsertWorkspaceActivation({
      workspaceId: WORKSPACE,
      enabled: true,
      activePolicyVersionId: versionId,
      updatedAt: NOW,
    });
    await modelProfiles.saveModelProfile(
      ModelProfile.create({
        id: PROFILE_ID,
        workspaceId: WORKSPACE,
        key: "judge",
        name: "Judge",
        createdAt: NOW,
      }),
    );
    await modelProfiles.appendModelProfileVersion({
      id: PROFILE_V,
      modelProfileId: PROFILE_ID,
      provider: "OPENAI",
      model: "gpt-judge",
      pricing: {
        currency: "USD",
        inputUsdMicrosPerMillionTokens: 1_000_000,
        outputUsdMicrosPerMillionTokens: 2_000_000,
      },
      createdAt: NOW,
    });
  });

  afterAll(async () => {
    await database.close();
    await stopPostgresForTests(postgres);
  });

  function buildStack(providerCalls: { count: number }) {
    const inner = {
      generateCompletionOutcome: vi.fn(async () => {
        providerCalls.count += 1;
        return {
          text: '{"pass":true}',
          usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
        };
      }),
    };
    const gateway = new BudgetEnforcingModelGateway({
      inner: inner as never,
      modelProfiles,
      admission,
      now: () => NOW,
    });
    const judgeModel = createEvaluationJudgeModelInvoker(gateway);
    return { judgeModel, inner, gateway, providerCalls };
  }

  async function judgeBudgetBinding(
    taskId: EvaluationJudgeTaskId,
    sequence: number,
  ) {
    const version = await modelProfiles.findModelProfileVersionById(PROFILE_V);
    const runtime = await policies.findRuntimePolicyByWorkspaceId(WORKSPACE);
    return resolveEvaluationJudgeBudgetContext({
      workspaceId: WORKSPACE,
      admission,
      runtimePolicy: runtime,
      evaluationJudgeTaskId: taskId,
      sequence,
      modelProfileVersionId: PROFILE_V,
      modelProfileVersion: version,
    });
  }

  it("J1: judge admits and calls provider exactly once", async () => {
    const providerCalls = { count: 0 };
    const { judgeModel } = buildStack(providerCalls);
    const taskId = "ejt-j1" as EvaluationJudgeTaskId;
    const budget = await judgeBudgetBinding(taskId, 1);
    expect(budget.enforcement).toBe("ENABLED");
    await judgeModel.generateJudgeCompletion(
      {
        modelProfileVersionId: PROFILE_V,
        messages: [{ role: "user", content: "score" }],
        maxOutputTokens: 200,
      },
      { budget },
    );
    expect(providerCalls.count).toBe(1);
  });

  it("J2: judge denied when period exhausted — zero provider calls", async () => {
    await policies.savePolicyVersion({
      id: "ibpv-judge-tight" as InferenceBudgetPolicyVersionId,
      policyId: "ibp-judge" as InferenceBudgetPolicyId,
      workspaceId: WORKSPACE,
      version: 2,
      definition: {
        schemaVersion: "1",
        periodKind: "CALENDAR_MONTH_UTC",
        periodLimitUsdMicros: 10_000,
        periodEnforcement: "STRICT_PERIOD_CAP",
        unknownAdmitCostBehavior: "DENY_ADMISSION",
        onLeaseLoss: "RECONCILIATION_REQUIRED",
      },
      createdAt: NOW,
    });
    await policies.upsertWorkspaceActivation({
      workspaceId: WORKSPACE,
      enabled: true,
      activePolicyVersionId:
        "ibpv-judge-tight" as InferenceBudgetPolicyVersionId,
      updatedAt: NOW,
    });
    const providerCalls = { count: 0 };
    const { judgeModel } = buildStack(providerCalls);
    const budget = await judgeBudgetBinding(
      "ejt-j2" as EvaluationJudgeTaskId,
      1,
    );
    await expect(
      judgeModel.generateJudgeCompletion(
        {
          modelProfileVersionId: PROFILE_V,
          messages: [{ role: "user", content: "x".repeat(4000) }],
          maxOutputTokens: 8_000,
        },
        { budget },
      ),
    ).rejects.toMatchObject({
      code: MODEL_ERROR_CODES.MODEL_INFERENCE_BUDGET_EXCEEDED,
    });
    expect(providerCalls.count).toBe(0);
  });

  it("J-PW: pairwise judge path admits with stable EVALUATION_JUDGE anchor", async () => {
    const providerCalls = { count: 0 };
    const { judgeModel } = buildStack(providerCalls);
    const taskId = "ejt-pairwise" as EvaluationJudgeTaskId;
    const anchor = {
      anchorFormatVersion: INFERENCE_INVOCATION_ANCHOR_FORMAT_VERSION,
      workspaceId: WORKSPACE,
      invocationKind: "JUDGE" as const,
      material: {
        scope: "EVALUATION_JUDGE" as const,
        evaluationJudgeTaskId: taskId,
        sequence: 0,
      },
    };
    const firstKey = buildInferenceInvocationAnchorString(anchor);
    const replayKey = buildInferenceInvocationAnchorString({
      ...anchor,
      material: { ...anchor.material, sequence: 0 },
    });
    expect(firstKey).toBe(replayKey);
    await judgeModel.generateJudgeCompletion(
      {
        modelProfileVersionId: PROFILE_V,
        messages: [{ role: "user", content: "pairwise" }],
      },
      { budget: await judgeBudgetBinding(taskId, 0) },
    );
    expect(providerCalls.count).toBe(1);
  });

  it("J7: policy enabled after BYPASS — subsequent judge enforces", async () => {
    await policies.upsertWorkspaceActivation({
      workspaceId: WORKSPACE,
      enabled: false,
      activePolicyVersionId: null,
      updatedAt: NOW,
    });
    const runtimeOff = await policies.findRuntimePolicyByWorkspaceId(WORKSPACE);
    expect(runtimeOff?.enabled).not.toBe(true);
    await policies.upsertWorkspaceActivation({
      workspaceId: WORKSPACE,
      enabled: true,
      activePolicyVersionId: "ibpv-judge" as InferenceBudgetPolicyVersionId,
      updatedAt: new Date(NOW.getTime() + 1),
    });
    const providerCalls = { count: 0 };
    const { judgeModel } = buildStack(providerCalls);
    await judgeModel.generateJudgeCompletion(
      {
        modelProfileVersionId: PROFILE_V,
        messages: [{ role: "user", content: "after activation" }],
      },
      {
        budget: await judgeBudgetBinding("ejt-j7" as EvaluationJudgeTaskId, 1),
      },
    );
    expect(providerCalls.count).toBe(1);
    const runtimeOn = await policies.findRuntimePolicyByWorkspaceId(WORKSPACE);
    expect(runtimeOn?.enabled).toBe(true);
  });
});
