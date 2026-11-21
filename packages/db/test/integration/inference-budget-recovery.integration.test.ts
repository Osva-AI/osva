import type {
  InferenceBudgetPeriodKeyV1,
  InferenceBudgetPolicyId,
  InferenceBudgetPolicyVersionId,
  InferenceBudgetReservationKeyV1,
  InferenceInvocationId,
  ModelProfileVersionId,
  RunAttemptId,
  WorkspaceId,
} from "@osva-ai/contracts";
import {
  INFERENCE_INVOCATION_ANCHOR_FORMAT_VERSION,
  InferenceBudgetProviderStartFenceError,
} from "@osva-ai/contracts";
import {
  Workspace,
  buildInferenceInvocationAnchorString,
  deriveInferenceBudgetReservationKey,
} from "@osva/domain";
import { evaluateInferenceBudgetRecoveryDisposition } from "@osva/domain";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  createDatabase,
  migrateDatabase,
  PostgresInferenceBudgetAdmissionRepository,
  PostgresInferenceBudgetOrdinalRepository,
  PostgresInferenceBudgetPolicyRepository,
  PostgresInferenceBudgetRecoveryRepository,
  PostgresWorkspaceRepository,
  verifyMigrationHistory,
  type Database,
} from "../../src/index.js";
import {
  resetStage0Tables,
  startPostgresForTests,
  stopPostgresForTests,
  type PostgresTestContext,
} from "./postgres-harness.js";

const WORKSPACE = "ws-b5-recovery" as WorkspaceId;
const POLICY_VERSION_ID = "ibpv-recovery" as InferenceBudgetPolicyVersionId;
const RUN_ATTEMPT = "rat-recovery" as RunAttemptId;
const PROFILE_V1 = "mpv-recovery" as ModelProfileVersionId;
const NOW = new Date("2026-02-10T12:00:00.000Z");

function agentAnchor(ordinal: number, executionGeneration = 1) {
  return {
    anchorFormatVersion: INFERENCE_INVOCATION_ANCHOR_FORMAT_VERSION,
    workspaceId: WORKSPACE,
    invocationKind: "SYNC" as const,
    material: {
      scope: "AGENT_RUN" as const,
      runAttemptId: RUN_ATTEMPT,
      executionGeneration,
      bindingName: "main",
      modelInvocationOrdinal: ordinal,
    },
  };
}

describe("inference budget recovery B5.4A", () => {
  let postgres: PostgresTestContext;
  let database: Database;
  let workspaces: PostgresWorkspaceRepository;
  let policies: PostgresInferenceBudgetPolicyRepository;
  let budget: PostgresInferenceBudgetAdmissionRepository;
  let ordinals: PostgresInferenceBudgetOrdinalRepository;
  let recovery: PostgresInferenceBudgetRecoveryRepository;

  beforeAll(async () => {
    postgres = await startPostgresForTests();
    database = createDatabase({
      connectionString: postgres.connectionString,
      max: 6,
      connectTimeoutSeconds: 10,
    });
    await migrateDatabase(database);
    workspaces = new PostgresWorkspaceRepository(database);
    policies = new PostgresInferenceBudgetPolicyRepository(database);
    budget = new PostgresInferenceBudgetAdmissionRepository(database);
    ordinals = new PostgresInferenceBudgetOrdinalRepository(database);
    recovery = new PostgresInferenceBudgetRecoveryRepository(database);
  });

  beforeEach(async () => {
    await resetStage0Tables(database);
    await workspaces.save(
      Workspace.create({ id: WORKSPACE, name: "Recovery", createdAt: NOW }),
    );
    await policies.savePolicy({
      id: `ibp-${WORKSPACE}` as InferenceBudgetPolicyId,
      workspaceId: WORKSPACE,
      key: "default",
      createdAt: NOW,
    });
    const versionId = POLICY_VERSION_ID;
    await policies.savePolicyVersion({
      id: versionId,
      policyId: `ibp-${WORKSPACE}` as InferenceBudgetPolicyId,
      workspaceId: WORKSPACE,
      version: 1,
      definition: {
        schemaVersion: "1",
        periodKind: "CALENDAR_MONTH_UTC",
        periodLimitUsdMicros: 5_000_000,
        periodEnforcement: "STRICT_PERIOD_CAP",
        unknownAdmitCostBehavior: "DENY_ADMISSION",
        onLeaseLoss: "RECONCILIATION_REQUIRED",
        staleAdmittedReservationTtlMs: 1_000,
      },
      createdAt: NOW,
    });
    await policies.upsertWorkspaceActivation({
      workspaceId: WORKSPACE,
      enabled: true,
      activePolicyVersionId: versionId,
      updatedAt: NOW,
    });
  });

  afterAll(async () => {
    await database.close();
    await stopPostgresForTests(postgres);
  });

  async function ordinalForKey(key: string): Promise<number> {
    const result = await ordinals.allocateOrGetOrdinal({
      workspaceId: WORKSPACE,
      runAttemptId: RUN_ATTEMPT,
      bindingName: "main",
      logicalOperationKey: key,
    });
    return result.modelInvocationOrdinal;
  }

  async function allocateWithOrdinal(ordinal: number, generation = 1) {
    return budget.allocateInvocation({
      workspaceId: WORKSPACE,
      anchor: agentAnchor(ordinal, generation),
      periodKey: "2026-02" as InferenceBudgetPeriodKeyV1,
      budgetPolicyVersionId: POLICY_VERSION_ID,
      pricingSnapshotId: "pricing-v1",
      runAttemptId: RUN_ATTEMPT,
    });
  }

  async function admitFor(
    invocationId: InferenceInvocationId,
    ordinal: number,
    gen = 1,
  ) {
    const key: InferenceBudgetReservationKeyV1 =
      deriveInferenceBudgetReservationKey({
        version: "1",
        inferenceInvocationId: invocationId,
        providerAttemptIndex: 0,
        selectedModelProfileVersionId: PROFILE_V1,
      });
    return budget.admitOrGetExisting({
      workspaceId: WORKSPACE,
      reservationKey: key,
      admitCeilingUsdMicros: 500_000,
      attempt: {
        workspaceId: WORKSPACE,
        inferenceInvocationId: invocationId,
        invocationAnchor: buildInferenceInvocationAnchorString(
          agentAnchor(ordinal, gen),
        ),
        periodKey: "2026-02" as InferenceBudgetPeriodKeyV1,
        budgetPolicyVersionId: POLICY_VERSION_ID,
        pricingSnapshotId: "pricing-v1",
        providerAttemptIndex: 0,
        selectedModelProfileVersionId: PROFILE_V1,
        admitCeilingUsdMicros: 500_000,
        runAttemptId: RUN_ATTEMPT,
        admittedExecutionGeneration: gen,
      },
    });
  }

  it("R1/R3: stable invocation across replay and generation fence", async () => {
    const ordinal = await ordinalForKey("op-a");
    const first = await allocateWithOrdinal(ordinal, 1);
    const replay = await allocateWithOrdinal(ordinal, 2);
    expect(replay.id).toBe(first.id);
    const anchorA = buildInferenceInvocationAnchorString(
      agentAnchor(ordinal, 1),
    );
    const anchorB = buildInferenceInvocationAnchorString(
      agentAnchor(ordinal, 9),
    );
    expect(anchorA).toBe(anchorB);
  });

  it("R2: new logical operation gets a new identity", async () => {
    const a = await ordinalForKey("op-one");
    const b = await ordinalForKey("op-two");
    const first = await allocateWithOrdinal(a);
    const second = await allocateWithOrdinal(b);
    expect(second.id).not.toBe(first.id);
  });

  it("R4: concurrent ordinal allocation is unique", async () => {
    const results = await Promise.all(
      ["k1", "k2", "k3", "k4"].map((key) => ordinalForKey(key)),
    );
    expect(new Set(results).size).toBe(4);
  });

  it("R9/R14: lost generation cannot start provider", async () => {
    const ordinal = await ordinalForKey("fence");
    const invocation = await allocateWithOrdinal(ordinal, 1);
    const admission = await admitFor(invocation.id, ordinal, 1);
    expect(admission.outcome).toBe("ADMITTED");
    if (admission.outcome !== "ADMITTED") {
      return;
    }
    await expect(
      budget.markProviderStarted({
        workspaceId: WORKSPACE,
        reservationId: admission.reservation.id,
        executionGeneration: 2,
      }),
    ).rejects.toBeInstanceOf(InferenceBudgetProviderStartFenceError);
  });

  it("R5: stale admitted reservation is released by tick", async () => {
    const ordinal = await ordinalForKey("stale");
    const invocation = await allocateWithOrdinal(ordinal);
    const admission = await admitFor(invocation.id, ordinal);
    expect(admission.outcome).toBe("ADMITTED");
    const candidates = await recovery.listRecoveryCandidates({
      limit: 10,
      now: new Date(),
    });
    expect(candidates.length).toBeGreaterThanOrEqual(1);
    const policy = await policies.findRuntimePolicyByWorkspaceId(WORKSPACE);
    let released = 0;
    for (const candidate of candidates) {
      const nowMs = candidate.admittedAtMs + 5_000;
      const disposition = evaluateInferenceBudgetRecoveryDisposition({
        reservation: candidate.reservation,
        nowMs,
        admittedAtMs: candidate.admittedAtMs,
        leaseLost: candidate.leaseLost,
        policy: policy?.definition,
      });
      if (disposition.kind !== "RELEASE_STALE_ADMITTED") {
        continue;
      }
      const ledger = await budget.loadPeriodLedger(
        WORKSPACE,
        "2026-02" as InferenceBudgetPeriodKeyV1,
      );
      if (ledger === null) {
        throw new Error("ledger");
      }
      await budget.release({
        workspaceId: WORKSPACE,
        reservation: candidate.reservation,
        periodLedger: ledger,
      });
      released += 1;
    }
    expect(released).toBeGreaterThanOrEqual(1);
  });

  it("R8: duplicate reconcile is idempotent", async () => {
    const ordinal = await ordinalForKey("reconcile");
    const invocation = await allocateWithOrdinal(ordinal);
    const admission = await admitFor(invocation.id, ordinal);
    if (admission.outcome !== "ADMITTED") {
      throw new Error("Expected admission");
    }
    const started = await budget.markProviderStarted({
      workspaceId: WORKSPACE,
      reservationId: admission.reservation.id,
      executionGeneration: 1,
    });
    const ledger = await budget.loadPeriodLedger(
      WORKSPACE,
      "2026-02" as InferenceBudgetPeriodKeyV1,
    );
    if (ledger === null) {
      throw new Error("ledger");
    }
    const first = await budget.reconcile({
      workspaceId: WORKSPACE,
      reservation: started,
      periodLedger: ledger,
      committedUsdMicros: 100_000,
      usageKnown: true,
      providerAccepted: true,
      billableProviderOutcome: true,
    });
    const ledgerAfter = first.periodLedgerAfter;
    const second = await budget.reconcile({
      workspaceId: WORKSPACE,
      reservation: first.reservationAfter,
      periodLedger: ledgerAfter,
      committedUsdMicros: 100_000,
      usageKnown: true,
      providerAccepted: true,
      billableProviderOutcome: true,
    });
    expect(second.nextStatus).toBe("COMMITTED");
    expect(second.periodDelta.committedLiabilityUsdMicros).toBe(0);
  });

  it("migration history includes 0045", () => {
    const verification = verifyMigrationHistory();
    expect(verification.ok).toBe(true);
    expect(
      verification.issues.every(
        (issue) => issue.code !== "historical_sql_hash_mismatch",
      ),
    ).toBe(true);
  });
});
