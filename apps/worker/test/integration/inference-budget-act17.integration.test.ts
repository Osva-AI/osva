/**
 * B5.6A — ACT17 in-flight policy version switch and disable semantics.
 */
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import {
  SECURITY_AUDIT_EVENT_TYPES,
  createDefaultInferenceBudgetPolicyDefinition,
  type InferenceBudgetPolicyVersionId,
} from "@osva-ai/contracts";
import {
  createDatabase,
  migrateDatabase,
  PostgresInferenceBudgetPolicyRepository,
  type Database,
} from "@osva/db";
import { startFakeOpenAIResponsesServer } from "../../../../adapters/model-openai/test/fake-openai-server.js";
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
import { bootstrapIntegrationAuth, fetchJson } from "./integration-auth.js";
import {
  BUDGET_POLICY_ID,
  BUDGET_POLICY_VERSION_ID,
  BUDGET_WORKSPACE,
  activateInferenceBudgetPolicyViaApi,
  activateRoutingPolicy,
  createBudgetWorkerStack,
  createRun,
  disableInferenceBudgetPolicyViaApi,
  listReservations,
  readPeriodLedger,
  seedInferenceBudgetPolicy,
} from "./inference-budget-worker-harness.js";

const NOW = new Date("2026-02-15T12:00:00.000Z");
const V2_ID = "ibpv-worker-v2" as InferenceBudgetPolicyVersionId;

async function waitUntilBudget(
  check: () => Promise<boolean>,
  timeoutMs = 120_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error("waitUntilBudget timed out");
}

async function listReservationAttribution(database: Database): Promise<
  Array<{
    budget_policy_version_id: string;
    status: string;
    period_key: string;
    pricing_snapshot_id: string;
  }>
> {
  const rows = await database.sql`
    SELECT r.budget_policy_version_id, r.status, i.period_key, r.pricing_snapshot_id
    FROM inference_budget_reservations r
    INNER JOIN inference_invocations i ON i.id = r.inference_invocation_id
    WHERE r.workspace_id = ${BUDGET_WORKSPACE}
    ORDER BY r.created_at ASC
  `;
  return rows as typeof rows;
}

describe("B5.6A ACT17 — in-flight version switch", () => {
  let postgres: PostgresTestContext;
  let valkey: ValkeyTestContext;
  let database: Database;

  beforeAll(async () => {
    postgres = await startPostgresForTests();
    valkey = await startValkeyForTests();
    database = createDatabase({
      connectionString: postgres.connectionString,
      max: 6,
      connectTimeoutSeconds: 10,
    });
    await migrateDatabase(database);
  }, 180_000);

  afterAll(async () => {
    await database.close();
    await stopPostgresForTests(postgres);
    await stopValkeyForTests(valkey);
  });

  beforeEach(async () => {
    await resetStage0Tables(database);
    await bootstrapIntegrationAuth(database, BUDGET_WORKSPACE, NOW);
    await seedInferenceBudgetPolicy(database, {
      workspaceId: BUDGET_WORKSPACE,
      enabled: false,
      periodLimitUsdMicros: 10_000_000,
      now: NOW,
    });
  });

  afterEach(async () => {
    await database.sql`DELETE FROM security_audit_events WHERE workspace_id = ${BUDGET_WORKSPACE}`;
  });

  async function appendPolicyVersionV2(): Promise<void> {
    const policies = new PostgresInferenceBudgetPolicyRepository(database);
    await policies.appendPolicyVersion({
      id: V2_ID,
      policyId: BUDGET_POLICY_ID,
      workspaceId: BUDGET_WORKSPACE,
      definition: {
        ...createDefaultInferenceBudgetPolicyDefinition(),
        periodLimitUsdMicros: 10_000_000,
      },
      createdAt: NOW,
    });
  }

  it("ACT17: in-flight reservation keeps V1; new invocation uses V2; disable preserves liability", async () => {
    const fake = await startFakeOpenAIResponsesServer();
    const stack = await createBudgetWorkerStack({
      postgres,
      valkey,
      fakeOrigin: fake.origin,
      modelName: "gpt-budget-slow",
      activationApiEnabled: true,
    });

    try {
      await activateRoutingPolicy(stack.origin, {
        key: "budget-routing",
        definition: {
          schemaVersion: "1",
          strategy: "PRIORITY_WITH_FALLBACK",
          candidateModelProfileVersionIds: [stack.modelProfileVersionId],
          allowFallback: false,
          maxProviderAttempts: 1,
        },
      });
      await activateInferenceBudgetPolicyViaApi(
        stack.origin,
        BUDGET_POLICY_VERSION_ID,
      );

      const { runId } = await createRun(
        stack.origin,
        stack.agentId,
        stack.agentVersionId,
        "act17-slow",
      );

      await waitUntilBudget(async () => {
        const rows = await listReservations(database, BUDGET_WORKSPACE);
        return (
          fake.requests.length === 1 &&
          rows.some((r) => r.status === "PROVIDER_STARTED")
        );
      });

      const inFlight = await listReservationAttribution(database);
      expect(inFlight.length).toBe(1);
      expect(inFlight[0]?.budget_policy_version_id).toBe(
        BUDGET_POLICY_VERSION_ID,
      );
      const periodKey = inFlight[0]?.period_key;
      expect(periodKey).toBeDefined();

      await appendPolicyVersionV2();
      await activateInferenceBudgetPolicyViaApi(stack.origin, V2_ID);

      const auditRows = await database.sql`
        SELECT event_type, details
        FROM security_audit_events
        WHERE workspace_id = ${BUDGET_WORKSPACE}
          AND event_type = ${SECURITY_AUDIT_EVENT_TYPES.WORKSPACE_INFERENCE_BUDGET_ACTIVATION_CHANGED}
        ORDER BY occurred_at ASC
      `;
      expect(auditRows.length).toBeGreaterThanOrEqual(2);
      const lastDetail = auditRows[auditRows.length - 1]?.details as {
        newPolicyVersionId?: string;
        action?: string;
      };
      expect(lastDetail?.action).toBe("ACTIVATE");
      expect(lastDetail?.newPolicyVersionId).toBe(V2_ID);

      const duringSwitch = await listReservationAttribution(database);
      expect(duringSwitch[0]?.budget_policy_version_id).toBe(
        BUDGET_POLICY_VERSION_ID,
      );
      expect(duringSwitch[0]?.period_key).toBe(periodKey);

      const ledgerMid = await readPeriodLedger(
        database,
        BUDGET_WORKSPACE,
        periodKey!,
      );
      const overageBefore = ledgerMid?.overage_usd_micros ?? 0;
      const committedBefore = ledgerMid?.committed_liability_usd_micros ?? 0;

      const secondRun = await createRun(
        stack.origin,
        stack.agentId,
        stack.agentVersionId,
        "act17-after-switch",
      );

      await waitUntilBudget(async () => {
        const rows = await listReservationAttribution(database);
        return (
          fake.requests.length === 2 &&
          rows.some((r) => r.budget_policy_version_id === V2_ID)
        );
      });

      expect(fake.requests.length).toBe(2);
      const afterOverlap = await listReservationAttribution(database);
      expect(afterOverlap[0]?.budget_policy_version_id).toBe(
        BUDGET_POLICY_VERSION_ID,
      );

      await waitUntilBudget(async () => {
        const first = await fetchJson(`${stack.origin}/v1/runs/${runId}`);
        const second = await fetchJson(
          `${stack.origin}/v1/runs/${secondRun.runId}`,
        );
        const firstDone = ["SUCCEEDED", "FAILED"].includes(
          (first.body as { status?: string }).status ?? "",
        );
        const secondDone = ["SUCCEEDED", "FAILED"].includes(
          (second.body as { status?: string }).status ?? "",
        );
        return firstDone && secondDone;
      });

      const allRows = await listReservationAttribution(database);
      expect(allRows.length).toBe(2);
      const v2Row = allRows.find((r) => r.budget_policy_version_id === V2_ID);
      expect(v2Row).toBeDefined();
      expect(
        allRows.filter(
          (r) => r.budget_policy_version_id === BUDGET_POLICY_VERSION_ID,
        ).length,
      ).toBe(1);

      const ledgerAfter = await readPeriodLedger(
        database,
        BUDGET_WORKSPACE,
        periodKey!,
      );
      expect(ledgerAfter?.overage_usd_micros).toBe(overageBefore);
      expect(
        (ledgerAfter?.committed_liability_usd_micros ?? 0) >= committedBefore,
      ).toBe(true);
    } finally {
      await stack.shutdown();
      await fake.close();
    }
  }, 120_000);

  it("ACT17b: disable during in-flight invocation does not erase reservation liability", async () => {
    const fake = await startFakeOpenAIResponsesServer();
    const stack = await createBudgetWorkerStack({
      postgres,
      valkey,
      fakeOrigin: fake.origin,
      fixtureName: "model-budget-hang-agent.ts",
      agentKey: "model-budget-hang-agent",
      activationApiEnabled: true,
    });

    try {
      await activateRoutingPolicy(stack.origin, {
        key: "budget-routing",
        definition: {
          schemaVersion: "1",
          strategy: "PRIORITY_WITH_FALLBACK",
          candidateModelProfileVersionIds: [stack.modelProfileVersionId],
          allowFallback: false,
          maxProviderAttempts: 1,
        },
      });
      await activateInferenceBudgetPolicyViaApi(
        stack.origin,
        BUDGET_POLICY_VERSION_ID,
      );

      await createRun(
        stack.origin,
        stack.agentId,
        stack.agentVersionId,
        "ignored-hang-fixture",
      );

      await waitUntilBudget(async () => {
        const rows = await listReservations(database, BUDGET_WORKSPACE);
        return (
          fake.requests.length === 1 &&
          rows.some((r) => r.status === "PROVIDER_STARTED")
        );
      });

      const beforeDisable = await listReservations(database, BUDGET_WORKSPACE);
      const heldBefore = beforeDisable.reduce(
        (s, r) => s + r.reserved_usd_micros,
        0,
      );

      await disableInferenceBudgetPolicyViaApi(stack.origin);

      const policies = new PostgresInferenceBudgetPolicyRepository(database);
      const activation =
        await policies.findWorkspaceActivation(BUDGET_WORKSPACE);
      expect(activation?.enabled).toBe(false);

      const afterDisable = await listReservations(database, BUDGET_WORKSPACE);
      expect(afterDisable.length).toBe(beforeDisable.length);
      expect(afterDisable.reduce((s, r) => s + r.reserved_usd_micros, 0)).toBe(
        heldBefore,
      );
    } finally {
      await stack.shutdown();
      await fake.close();
    }
  }, 180_000);
});
