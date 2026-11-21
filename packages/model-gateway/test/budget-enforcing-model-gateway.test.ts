import type {
  InferenceBudgetAdmissionOutcomeV1,
  InferenceBudgetAdmissionPort,
  InferenceBudgetReservationId,
  InferenceBudgetReservationSnapshotV1,
  InferenceInvocationId,
  InferenceInvocationRecordV1,
  ModelProfileId,
  ModelProfileVersionId,
  WorkspaceId,
} from "@osva-ai/contracts";
import {
  INFERENCE_INVOCATION_ANCHOR_FORMAT_VERSION,
  MODEL_ERROR_CODES,
} from "@osva-ai/contracts";
import { MemoryModelProfileRepository } from "@osva/adapters-memory";
import { ModelProfile } from "@osva/domain";
import { describe, expect, it, vi } from "vitest";

import { BudgetEnforcingModelGateway } from "../src/budget-enforcing-model-gateway.js";
import type { TrustedModelGatewayBudgetBindingV1 } from "../src/model-gateway-budget-context.js";
import { ModelGatewayError } from "../src/errors.js";

const workspaceId = "ws-budget-gw" as WorkspaceId;
const mpv = "mpv-budget-gw" as ModelProfileVersionId;
const mp = "mp-budget-gw" as ModelProfileId;
const NOW = new Date("2026-03-01T12:00:00.000Z");

function enabledBinding(
  admission: InferenceBudgetAdmissionPort,
): TrustedModelGatewayBudgetBindingV1 {
  return {
    enforcement: "ENABLED",
    workspaceId,
    admission,
    runtimePolicy: {
      schemaVersion: "1",
      enabled: true,
      policyVersionId:
        "ibpv-gw" as InferenceBudgetReservationSnapshotV1["budgetPolicyVersionId"],
      definition: {
        schemaVersion: "1",
        periodKind: "CALENDAR_MONTH_UTC",
        periodLimitUsdMicros: 10_000_000,
        periodEnforcement: "STRICT_PERIOD_CAP",
        unknownAdmitCostBehavior: "DENY_ADMISSION",
        onLeaseLoss: "RECONCILIATION_REQUIRED",
      },
    },
    anchor: {
      anchorFormatVersion: INFERENCE_INVOCATION_ANCHOR_FORMAT_VERSION,
      workspaceId,
      invocationKind: "SYNC",
      material: {
        scope: "AGENT_RUN",
        runAttemptId: "rat-gw" as InferenceInvocationRecordV1["runAttemptId"] &
          string,
        executionGeneration: 1,
        bindingName: "main",
        modelInvocationOrdinal: 1,
      },
    },
    periodKey: "2026-03" as TrustedModelGatewayBudgetBindingV1["periodKey"],
    pricingSnapshotId: `mpv:${mpv}`,
    invocationKind: "SYNC",
    providerAttemptIndex: 0,
    selectedModelProfileVersionId: mpv,
  };
}

describe("BudgetEnforcingModelGateway", () => {
  async function seedProfile(repo: MemoryModelProfileRepository) {
    await repo.saveModelProfile(
      ModelProfile.create({
        id: mp,
        workspaceId,
        key: "main",
        name: "Main",
        createdAt: NOW,
      }),
    );
    await repo.appendModelProfileVersion({
      id: mpv,
      modelProfileId: mp,
      provider: "OPENAI",
      model: "gpt-test",
      pricing: {
        currency: "USD",
        inputUsdMicrosPerMillionTokens: 1_000_000,
        outputUsdMicrosPerMillionTokens: 2_000_000,
      },
      createdAt: NOW,
    });
  }

  it("G1: passes through when budget enforcement is disabled", async () => {
    const inner = {
      generateTextOutcome: vi.fn(async () => ({ text: "ok" })),
    };
    const gateway = new BudgetEnforcingModelGateway({
      inner: inner as never,
      modelProfiles: new MemoryModelProfileRepository(),
      admission: {} as InferenceBudgetAdmissionPort,
    });
    await gateway.generateTextOutcome(
      {
        modelProfileVersionId: mpv,
        messages: [{ role: "user", content: "hi" }],
      },
      undefined,
    );
    expect(inner.generateTextOutcome).toHaveBeenCalledTimes(1);
  });

  it("G3: denies provider call when admission returns DENIED", async () => {
    const profiles = new MemoryModelProfileRepository();
    await seedProfile(profiles);
    const admission: InferenceBudgetAdmissionPort = {
      allocateInvocation: vi.fn(async () => ({
        id: "iiv-gw" as InferenceInvocationId,
      })) as never,
      admitOrGetExisting: vi.fn(
        async (): Promise<InferenceBudgetAdmissionOutcomeV1> => ({
          outcome: "DENIED",
          errorCode: "MODEL_INFERENCE_BUDGET_EXCEEDED",
          retryable: false,
        }),
      ) as never,
      markProviderStarted: vi.fn(),
      reconcile: vi.fn(),
      release: vi.fn(),
      markReconciliationRequired: vi.fn(),
      loadPeriodLedger: vi.fn(),
      findReservationByKey: vi.fn(async () => null),
    };
    const inner = {
      generateTextOutcome: vi.fn(async () => ({ text: "nope" })),
    };
    const gateway = new BudgetEnforcingModelGateway({
      inner: inner as never,
      modelProfiles: profiles,
      admission,
    });
    await expect(
      gateway.generateTextOutcome(
        {
          modelProfileVersionId: mpv,
          messages: [{ role: "user", content: "hi" }],
          maxOutputTokens: 100,
        },
        { budget: enabledBinding(admission) },
      ),
    ).rejects.toMatchObject({
      code: MODEL_ERROR_CODES.MODEL_INFERENCE_BUDGET_EXCEEDED,
    });
    expect(inner.generateTextOutcome).not.toHaveBeenCalled();
    expect(admission.markProviderStarted).not.toHaveBeenCalled();
  });

  it("S1: judge binding denies provider without markProviderStarted", async () => {
    const profiles = new MemoryModelProfileRepository();
    await seedProfile(profiles);
    const admission: InferenceBudgetAdmissionPort = {
      allocateInvocation: vi.fn(async () => ({
        id: "iiv-judge" as InferenceInvocationId,
      })) as never,
      admitOrGetExisting: vi.fn(async () => ({
        outcome: "DENIED",
        errorCode: "MODEL_INFERENCE_BUDGET_EXCEEDED",
        retryable: false,
      })) as never,
      markProviderStarted: vi.fn(),
      reconcile: vi.fn(),
      release: vi.fn(),
      markReconciliationRequired: vi.fn(),
      loadPeriodLedger: vi.fn(),
      findReservationByKey: vi.fn(async () => null),
    };
    const inner = { generateCompletionOutcome: vi.fn() };
    const judgeBinding: TrustedModelGatewayBudgetBindingV1 = {
      ...enabledBinding(admission),
      invocationKind: "JUDGE",
      anchor: {
        anchorFormatVersion: INFERENCE_INVOCATION_ANCHOR_FORMAT_VERSION,
        workspaceId,
        invocationKind: "JUDGE",
        material: {
          scope: "EVALUATION_JUDGE",
          evaluationJudgeTaskId: "ejt-1" as never,
          sequence: 1,
        },
      },
    };
    const gateway = new BudgetEnforcingModelGateway({
      inner: inner as never,
      modelProfiles: profiles,
      admission,
    });
    await expect(
      gateway.generateCompletionOutcome(
        {
          modelProfileVersionId: mpv,
          messages: [{ role: "user", content: "judge" }],
        },
        { budget: judgeBinding },
      ),
    ).rejects.toMatchObject({
      code: MODEL_ERROR_CODES.MODEL_INFERENCE_BUDGET_EXCEEDED,
    });
    expect(inner.generateCompletionOutcome).not.toHaveBeenCalled();
    expect(admission.markProviderStarted).not.toHaveBeenCalled();
  });

  it("G2: admits then invokes provider once", async () => {
    const profiles = new MemoryModelProfileRepository();
    await seedProfile(profiles);
    const reservation: InferenceBudgetReservationSnapshotV1 = {
      id: "ibr-gw" as InferenceBudgetReservationId,
      workspaceId,
      reservationKey:
        "ibrk_v1_aaa" as InferenceBudgetReservationSnapshotV1["reservationKey"],
      inferenceInvocationId: "iiv-gw" as InferenceInvocationId,
      providerAttemptIndex: 0,
      selectedModelProfileVersionId: mpv,
      periodKey: "2026-03" as InferenceBudgetReservationSnapshotV1["periodKey"],
      budgetPolicyVersionId:
        "ibpv-gw" as InferenceBudgetReservationSnapshotV1["budgetPolicyVersionId"],
      pricingSnapshotId: `mpv:${mpv}`,
      status: "ADMITTED",
      reservedUsdMicros: 500_000,
    };
    const admission: InferenceBudgetAdmissionPort = {
      allocateInvocation: vi.fn(async () => ({
        id: "iiv-gw" as InferenceInvocationId,
      })) as never,
      admitOrGetExisting: vi.fn(
        async (): Promise<InferenceBudgetAdmissionOutcomeV1> => ({
          outcome: "ADMITTED",
          reservation,
          periodLedgerAfter: {
            workspaceId,
            period: {
              periodKind: "CALENDAR_MONTH_UTC",
              periodKey:
                "2026-03" as InferenceBudgetReservationSnapshotV1["periodKey"],
              periodStartUtc: "2026-03-01T00:00:00.000Z",
              periodEndExclusiveUtc: "2026-04-01T00:00:00.000Z",
            },
            budgetPolicyVersionId: reservation.budgetPolicyVersionId,
            limitUsdMicros: 10_000_000,
            committedLiabilityUsdMicros: 0,
            heldReservationsUsdMicros: 500_000,
            unresolvedUncertainLiabilityUsdMicros: 0,
            overageUsdMicros: 0,
          },
        }),
      ),
      markProviderStarted: vi.fn(),
      reconcile: vi.fn(async () => ({
        nextStatus: "COMMITTED" as const,
        periodDelta: {
          committedLiabilityUsdMicros: 100,
          heldReservationsUsdMicros: -500_000,
          unresolvedUncertainLiabilityUsdMicros: 0,
          overageUsdMicros: 0,
        },
        refundHeldUsdMicros: 400_000,
        overageUsdMicros: 0,
        committedUsdMicros: 100_000,
        periodLedgerAfter: {} as never,
        reservationAfter: {
          ...reservation,
          status: "COMMITTED" as const,
        },
      })) as never,
      release: vi.fn(),
      markReconciliationRequired: vi.fn(),
      loadPeriodLedger: vi.fn(),
      findReservationByKey: vi.fn(async () => null),
    };
    const callOrder: string[] = [];
    admission.markProviderStarted = vi.fn(async () => {
      callOrder.push("provider_started");
      return { ...reservation, status: "PROVIDER_STARTED" };
    }) as never;
    const inner = {
      generateTextOutcome: vi.fn(async () => {
        callOrder.push("provider_io");
        return {
          text: "ok",
          usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
        };
      }),
    };
    const gateway = new BudgetEnforcingModelGateway({
      inner: inner as never,
      modelProfiles: profiles,
      admission,
    });
    await gateway.generateTextOutcome(
      {
        modelProfileVersionId: mpv,
        messages: [{ role: "user", content: "hi" }],
        maxOutputTokens: 100,
      },
      { budget: enabledBinding(admission) },
    );
    expect(inner.generateTextOutcome).toHaveBeenCalledTimes(1);
    expect(admission.markProviderStarted).toHaveBeenCalledTimes(1);
    expect(admission.reconcile).toHaveBeenCalledTimes(1);
    expect(callOrder).toEqual(["provider_started", "provider_io"]);
  });

  it("G4: admission failure surfaces BUDGET_UNAVAILABLE without provider call", async () => {
    const profiles = new MemoryModelProfileRepository();
    await seedProfile(profiles);
    const admission: InferenceBudgetAdmissionPort = {
      allocateInvocation: vi.fn(async () => {
        throw new Error("db down");
      }),
      admitOrGetExisting: vi.fn(),
      markProviderStarted: vi.fn(),
      reconcile: vi.fn(),
      release: vi.fn(),
      markReconciliationRequired: vi.fn(),
      loadPeriodLedger: vi.fn(),
      findReservationByKey: vi.fn(async () => null),
    };
    const inner = { generateTextOutcome: vi.fn() };
    const gateway = new BudgetEnforcingModelGateway({
      inner: inner as never,
      modelProfiles: profiles,
      admission,
    });
    await expect(
      gateway.generateTextOutcome(
        {
          modelProfileVersionId: mpv,
          messages: [{ role: "user", content: "hi" }],
          maxOutputTokens: 50,
        },
        { budget: enabledBinding(admission) },
      ),
    ).rejects.toBeInstanceOf(ModelGatewayError);
    expect(inner.generateTextOutcome).not.toHaveBeenCalled();
  });
});
