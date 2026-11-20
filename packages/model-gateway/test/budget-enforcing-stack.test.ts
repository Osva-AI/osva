import type {
  ExactResponseCacheEntry,
  ExactResponseCacheLookupRequest,
  ExactResponseCacheLookupResult,
  ExactResponseCachePort,
  ExactResponseCachePutRequest,
  ExactResponseCachePutResult,
  InferenceBudgetAdmissionOutcomeV1,
  InferenceBudgetAdmissionPort,
  InferenceBudgetReservationId,
  InferenceBudgetReservationSnapshotV1,
  InferenceInvocationId,
  InferenceInvocationRecordV1,
  ModelProfileId,
  ModelProfileVersionId,
  ModelProviderConnectionVersionId,
  ModelStreamEvent,
  WorkspaceId,
} from "@osva-ai/contracts";
import {
  INFERENCE_INVOCATION_ANCHOR_FORMAT_VERSION,
  INFERENCE_MODEL_INVOCATION_SOURCES,
  MODEL_ERROR_CODES,
} from "@osva-ai/contracts";
import { MemoryModelProfileRepository } from "@osva/adapters-memory";
import { ModelProfile } from "@osva/domain";
import { describe, expect, it, vi } from "vitest";

import { BudgetEnforcingModelGateway } from "../src/budget-enforcing-model-gateway.js";
import { CachingModelGateway } from "../src/caching-model-gateway.js";
import { ModelGatewayError } from "../src/errors.js";
import type { TrustedModelGatewayBudgetBindingV1 } from "../src/model-gateway-budget-context.js";
import { collectModelStreamEvents } from "./model-stream-test-helpers.js";

const workspaceId = "ws-budget-stack" as WorkspaceId;
const mpv = "mpv-stack" as ModelProfileVersionId;
const mp = "mp-stack" as ModelProfileId;
const NOW = new Date("2026-03-01T12:00:00.000Z");

const cachePolicy = {
  schemaVersion: "1" as const,
  enabled: true,
  determinism: "REQUIRED_DETERMINISTIC" as const,
};

class MemoryExactResponseCache implements ExactResponseCachePort {
  readonly store = new Map<string, ExactResponseCacheEntry>();

  async lookup(
    request: ExactResponseCacheLookupRequest,
  ): Promise<ExactResponseCacheLookupResult> {
    const hit = this.store.get(request.storageKey);
    if (hit === undefined) {
      return { outcome: "miss" };
    }
    if (hit.identityDigest !== request.identityDigest) {
      return { outcome: "corrupt", identityDigest: hit.identityDigest };
    }
    return { outcome: "hit", entry: hit };
  }

  async putIfAbsent(
    request: ExactResponseCachePutRequest,
  ): Promise<ExactResponseCachePutResult> {
    if (this.store.has(request.storageKey)) {
      return { outcome: "exists" };
    }
    this.store.set(request.storageKey, request.entry);
    return { outcome: "created" };
  }
}

function baseReservation(
  status: InferenceBudgetReservationSnapshotV1["status"],
): InferenceBudgetReservationSnapshotV1 {
  return {
    id: "ibr-stack" as InferenceBudgetReservationId,
    workspaceId,
    reservationKey:
      "ibrk_stack" as InferenceBudgetReservationSnapshotV1["reservationKey"],
    inferenceInvocationId: "iiv-stack" as InferenceInvocationId,
    providerAttemptIndex: 0,
    selectedModelProfileVersionId: mpv,
    periodKey: "2026-03" as InferenceBudgetReservationSnapshotV1["periodKey"],
    budgetPolicyVersionId:
      "ibpv-stack" as InferenceBudgetReservationSnapshotV1["budgetPolicyVersionId"],
    pricingSnapshotId: `mpv:${mpv}`,
    status,
    reservedUsdMicros: 500_000,
  };
}

function enabledBinding(
  admission: InferenceBudgetAdmissionPort,
  ordinal = 1,
): TrustedModelGatewayBudgetBindingV1 {
  return {
    enforcement: "ENABLED",
    workspaceId,
    admission,
    runtimePolicy: {
      schemaVersion: "1",
      enabled: true,
      policyVersionId:
        "ibpv-stack" as InferenceBudgetReservationSnapshotV1["budgetPolicyVersionId"],
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
        runAttemptId:
          "rat-stack" as InferenceInvocationRecordV1["runAttemptId"] & string,
        executionGeneration: 1,
        bindingName: "main",
        modelInvocationOrdinal: ordinal,
      },
    },
    periodKey: "2026-03" as TrustedModelGatewayBudgetBindingV1["periodKey"],
    pricingSnapshotId: `mpv:${mpv}`,
    invocationKind: "SYNC",
    providerAttemptIndex: 0,
    selectedModelProfileVersionId: mpv,
  };
}

function admittedAdmission(): InferenceBudgetAdmissionPort {
  const reservation = baseReservation("ADMITTED");
  return {
    allocateInvocation: vi.fn(async () => ({
      id: "iiv-stack" as InferenceInvocationId,
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
    markProviderStarted: vi.fn(async () => ({
      ...reservation,
      status: "PROVIDER_STARTED" as const,
    })),
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
    loadPeriodLedger: vi.fn(async () => null),
    findReservationByKey: vi.fn(async () => null),
  };
}

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
    modelProviderConnectionVersionId:
      "conn-stack-v1" as ModelProviderConnectionVersionId,
    pricing: {
      currency: "USD",
      inputUsdMicrosPerMillionTokens: 1_000_000,
      outputUsdMicrosPerMillionTokens: 2_000_000,
      cachedReadInputUsdMicrosPerMillionTokens: 100_000,
    },
    createdAt: NOW,
  });
}

describe("Budget enforcement stack", () => {
  it("G5: exact-response cache hit does not admit budget or call provider", async () => {
    const profiles = new MemoryModelProfileRepository();
    await seedProfile(profiles);
    const admission = admittedAdmission();
    const inner = {
      generateTextOutcome: vi.fn(async () => ({
        text: "from-provider",
        finishReason: "stop" as const,
        usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
      })),
    };
    const stack = new CachingModelGateway({
      inner: new BudgetEnforcingModelGateway({
        inner: inner as never,
        modelProfiles: profiles,
        admission,
      }),
      modelProfiles: profiles,
      cache: new MemoryExactResponseCache(),
    });
    const options = {
      cache: {
        workspaceId,
        executionPurpose: "AGENT_RUN" as const,
        policy: cachePolicy,
      },
      budget: enabledBinding(admission),
    };
    const request = {
      modelProfileVersionId: mpv,
      messages: [{ role: "user" as const, content: "cached-prompt" }],
      maxOutputTokens: 64,
    };

    await stack.generateTextOutcome(request, options);
    await stack.generateTextOutcome(request, options);

    expect(inner.generateTextOutcome).toHaveBeenCalledTimes(1);
    expect(admission.admitOrGetExisting).toHaveBeenCalledTimes(1);
  });

  it("G6: cache miss admits before provider invocation", async () => {
    const profiles = new MemoryModelProfileRepository();
    await seedProfile(profiles);
    const callOrder: string[] = [];
    const reservation = baseReservation("ADMITTED");
    const admission: InferenceBudgetAdmissionPort = {
      allocateInvocation: vi.fn(async () => ({
        id: "iiv-stack" as InferenceInvocationId,
      })) as never,
      admitOrGetExisting: vi.fn(async () => {
        callOrder.push("admit");
        return {
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
        } satisfies InferenceBudgetAdmissionOutcomeV1;
      }),
      markProviderStarted: vi.fn(async () => ({
        ...reservation,
        status: "PROVIDER_STARTED" as const,
      })),
      reconcile: vi.fn(),
      release: vi.fn(),
      markReconciliationRequired: vi.fn(),
      loadPeriodLedger: vi.fn(async () => null),
      findReservationByKey: vi.fn(async () => null),
    };
    const inner = {
      generateTextOutcome: vi.fn(async () => {
        callOrder.push("provider");
        return {
          text: "ok",
          usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
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
        messages: [{ role: "user", content: "miss" }],
        maxOutputTokens: 16,
      },
      { budget: enabledBinding(admission) },
    );
    expect(callOrder).toEqual(["admit", "provider"]);
  });

  it("G7: provider prompt-cache usage is reconciled as billable", async () => {
    const profiles = new MemoryModelProfileRepository();
    await seedProfile(profiles);
    const admission = admittedAdmission();
    const inner = {
      generateTextOutcome: vi.fn(async () => ({
        text: "ok",
        invocationSource: INFERENCE_MODEL_INVOCATION_SOURCES[0],
        usage: {
          inputTokens: 100,
          outputTokens: 10,
          totalTokens: 110,
          cachedInputTokens: 80,
        },
      })),
    };
    const gateway = new BudgetEnforcingModelGateway({
      inner: inner as never,
      modelProfiles: profiles,
      admission,
    });
    await gateway.generateTextOutcome(
      {
        modelProfileVersionId: mpv,
        messages: [{ role: "user", content: "pc" }],
        maxOutputTokens: 32,
      },
      { budget: enabledBinding(admission) },
    );
    expect(admission.reconcile).toHaveBeenCalledWith(
      expect.objectContaining({
        usageKnown: true,
        committedUsdMicros: expect.any(Number),
      }),
    );
    const reconcileArg = (admission.reconcile as ReturnType<typeof vi.fn>).mock
      .calls[0]?.[0];
    expect(reconcileArg?.committedUsdMicros).toBeGreaterThan(0);
  });

  it("G12: unknown usage reconciles with usageKnown false", async () => {
    const profiles = new MemoryModelProfileRepository();
    await seedProfile(profiles);
    const admission = admittedAdmission();
    const inner = {
      generateTextOutcome: vi.fn(async () => ({
        text: "ok",
      })),
    };
    const gateway = new BudgetEnforcingModelGateway({
      inner: inner as never,
      modelProfiles: profiles,
      admission,
    });
    await gateway.generateTextOutcome(
      {
        modelProfileVersionId: mpv,
        messages: [{ role: "user", content: "nousage" }],
        maxOutputTokens: 8,
      },
      { budget: enabledBinding(admission) },
    );
    expect(admission.reconcile).toHaveBeenCalledWith(
      expect.objectContaining({
        usageKnown: false,
        committedUsdMicros: null,
      }),
    );
  });

  it("G13: provider failure after start still reconciles (no automatic refund)", async () => {
    const profiles = new MemoryModelProfileRepository();
    await seedProfile(profiles);
    const admission = admittedAdmission();
    const inner = {
      generateTextOutcome: vi.fn(async () => {
        throw new ModelGatewayError(
          MODEL_ERROR_CODES.MODEL_PROVIDER_ERROR,
          "boom",
        );
      }),
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
          messages: [{ role: "user", content: "fail" }],
          maxOutputTokens: 8,
        },
        { budget: enabledBinding(admission) },
      ),
    ).rejects.toBeInstanceOf(ModelGatewayError);
    expect(admission.markProviderStarted).toHaveBeenCalledTimes(1);
    expect(admission.reconcile).toHaveBeenCalledTimes(1);
    expect(admission.release).not.toHaveBeenCalled();
  });

  it("G16/G17: idempotent reservation does not authorize duplicate provider I/O", async () => {
    const profiles = new MemoryModelProfileRepository();
    await seedProfile(profiles);
    const reservation = baseReservation("PROVIDER_STARTED");
    const admission: InferenceBudgetAdmissionPort = {
      allocateInvocation: vi.fn(async () => ({
        id: "iiv-stack" as InferenceInvocationId,
      })) as never,
      admitOrGetExisting: vi.fn(
        async (): Promise<InferenceBudgetAdmissionOutcomeV1> => ({
          outcome: "IDEMPOTENT_EXISTING",
          reservation,
        }),
      ),
      markProviderStarted: vi.fn(),
      reconcile: vi.fn(),
      release: vi.fn(),
      markReconciliationRequired: vi.fn(),
      loadPeriodLedger: vi.fn(async () => null),
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
          messages: [{ role: "user", content: "replay" }],
          maxOutputTokens: 8,
        },
        { budget: enabledBinding(admission) },
      ),
    ).rejects.toMatchObject({
      code: MODEL_ERROR_CODES.MODEL_INFERENCE_BUDGET_UNAVAILABLE,
    });
    expect(inner.generateTextOutcome).not.toHaveBeenCalled();
    expect(admission.markProviderStarted).not.toHaveBeenCalled();
  });

  it("G14: streaming success reconciles terminal usage", async () => {
    const profiles = new MemoryModelProfileRepository();
    await seedProfile(profiles);
    const admission = admittedAdmission();
    const events: ModelStreamEvent[] = [
      {
        streamFormatVersion: "1",
        streamId: "s1",
        sequence: 0,
        kind: "TEXT_DELTA",
        textDelta: "hi",
      },
      {
        streamFormatVersion: "1",
        streamId: "s1",
        sequence: 1,
        kind: "USAGE_FINAL",
        usage: { inputUnits: 4, outputUnits: 2 },
      },
      {
        streamFormatVersion: "1",
        streamId: "s1",
        sequence: 2,
        kind: "COMPLETED",
        finishReason: "stop",
      },
    ];
    const inner = {
      generateCompletionStream: () => ({
        async *[Symbol.asyncIterator]() {
          for (const event of events) {
            yield event;
          }
        },
      }),
    };
    const gateway = new BudgetEnforcingModelGateway({
      inner: inner as never,
      modelProfiles: profiles,
      admission,
    });
    await collectModelStreamEvents(
      gateway.generateCompletionStream(
        {
          modelProfileVersionId: mpv,
          messages: [{ role: "user", content: "stream" }],
          maxOutputTokens: 16,
        },
        { budget: enabledBinding(admission) },
      ),
    );
    expect(admission.markProviderStarted).toHaveBeenCalledTimes(1);
    expect(admission.reconcile).toHaveBeenCalledWith(
      expect.objectContaining({ usageKnown: true }),
    );
  });

  it("G15: stream cancellation reconciles without releasing held capacity silently", async () => {
    const profiles = new MemoryModelProfileRepository();
    await seedProfile(profiles);
    const admission = admittedAdmission();
    const inner = {
      generateCompletionStream: () => ({
        async *[Symbol.asyncIterator]() {
          yield {
            streamFormatVersion: "1",
            streamId: "s2",
            sequence: 0,
            kind: "CANCELLED",
            reason: "OTHER",
          } satisfies ModelStreamEvent;
        },
      }),
    };
    const gateway = new BudgetEnforcingModelGateway({
      inner: inner as never,
      modelProfiles: profiles,
      admission,
    });
    await collectModelStreamEvents(
      gateway.generateCompletionStream(
        {
          modelProfileVersionId: mpv,
          messages: [{ role: "user", content: "cancel" }],
          maxOutputTokens: 8,
        },
        { budget: enabledBinding(admission) },
      ),
    );
    expect(admission.reconcile).toHaveBeenCalledWith(
      expect.objectContaining({
        nonBillableCancelBeforeAccept: true,
        billableProviderOutcome: false,
      }),
    );
    expect(admission.release).not.toHaveBeenCalled();
  });
});
