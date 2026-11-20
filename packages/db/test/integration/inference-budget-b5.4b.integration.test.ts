import {
  INFERENCE_INVOCATION_ANCHOR_FORMAT_VERSION,
  type EvaluationJudgeTaskId,
  type InferenceBudgetPeriodKeyV1,
  type InferenceBudgetPolicyId,
  type InferenceBudgetPolicyVersionId,
  type ModelProfileVersionId,
  type WorkspaceId,
} from "@osva-ai/contracts";
import { Workspace } from "@osva/domain";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  createDatabase,
  migrateDatabase,
  PostgresInferenceBudgetAdmissionRepository,
  PostgresInferenceBudgetPolicyRepository,
  PostgresWorkspaceRepository,
  type Database,
} from "../../src/index.js";

import {
  resetStage0Tables,
  startPostgresForTests,
  stopPostgresForTests,
  type PostgresTestContext,
} from "./postgres-harness.js";

const WORKSPACE = "ws-b54b" as WorkspaceId;
const POLICY_ID = "ibp-b54b" as InferenceBudgetPolicyId;
const POLICY_VERSION = "ibpv-b54b" as InferenceBudgetPolicyVersionId;
const PROFILE = "mpv-b54b" as ModelProfileVersionId;
const NOW = new Date("2026-01-15T12:00:00.000Z");

describe("B5.4B inference budget integration", () => {
  let postgres: PostgresTestContext;
  let database: Database;
  let workspaces: PostgresWorkspaceRepository;
  let policies: PostgresInferenceBudgetPolicyRepository;
  let budget: PostgresInferenceBudgetAdmissionRepository;

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
    budget = new PostgresInferenceBudgetAdmissionRepository(database);
  });

  beforeEach(async () => {
    await resetStage0Tables(database);
    await workspaces.save(
      Workspace.create({ id: WORKSPACE, name: "B54B", createdAt: NOW }),
    );
    await policies.savePolicy({
      id: POLICY_ID,
      workspaceId: WORKSPACE,
      key: "default",
      createdAt: NOW,
    });
    await policies.savePolicyVersion({
      id: POLICY_VERSION,
      policyId: POLICY_ID,
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
      activePolicyVersionId: POLICY_VERSION,
      updatedAt: NOW,
    });
  });

  afterAll(async () => {
    await database.close();
    await stopPostgresForTests(postgres);
  });

  it("E1/E4: judge logical invocation anchor is durable across allocate", async () => {
    const taskId = "ejt-b54b" as EvaluationJudgeTaskId;
    const anchor = {
      anchorFormatVersion: INFERENCE_INVOCATION_ANCHOR_FORMAT_VERSION,
      workspaceId: WORKSPACE,
      invocationKind: "JUDGE" as const,
      material: {
        scope: "EVALUATION_JUDGE" as const,
        evaluationJudgeTaskId: taskId,
        sequence: 1,
      },
    };
    const first = await budget.allocateInvocation({
      workspaceId: WORKSPACE,
      anchor,
      periodKey: "2026-01" as InferenceBudgetPeriodKeyV1,
      budgetPolicyVersionId: POLICY_VERSION,
      pricingSnapshotId: `mpv:${PROFILE}`,
    });
    const second = await budget.allocateInvocation({
      workspaceId: WORKSPACE,
      anchor,
      periodKey: "2026-01" as InferenceBudgetPeriodKeyV1,
      budgetPolicyVersionId: POLICY_VERSION,
      pricingSnapshotId: `mpv:${PROFILE}`,
    });
    expect(second.id).toBe(first.id);
  });
});
