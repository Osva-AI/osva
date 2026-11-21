import type {
  GenerateCompletionRequest,
  InferenceBudgetAdmissionOutcomeV1,
  InferenceBudgetReservationSnapshotV1,
  InferenceRoutingRuntimePolicyV1,
  ModelProfileId,
  ModelProfileVersionId,
  ModelStreamEvent,
  WorkspaceId,
} from "@osva-ai/contracts";
import {
  INFERENCE_INVOCATION_ANCHOR_FORMAT_VERSION,
  MODEL_ERROR_CODES,
  MODEL_STREAM_EVENT_FORMAT_VERSION,
} from "@osva-ai/contracts";
import { MemoryModelProfileRepository } from "@osva/adapters-memory";
import { ModelProfile } from "@osva/domain";
import { describe, expect, it, vi } from "vitest";

import { ModelGatewayError } from "../src/errors.js";
import type { TrustedModelGatewayBudgetBindingV1 } from "../src/model-gateway-budget-context.js";
import { RoutingModelGateway } from "../src/routing-model-gateway.js";
import type { ModelGatewayGenerateTextOptions } from "../src/provider-adapter.js";
import type { InferenceBudgetAdmissionPort } from "@osva-ai/contracts";

const workspaceId = "ws-stream-route" as WorkspaceId;
const mp1 = "mp-stream-1" as ModelProfileId;
const mpvA = "mpv-stream-a" as ModelProfileVersionId;
const mpvB = "mpv-stream-b" as ModelProfileVersionId;
const NOW = new Date("2026-02-01T00:00:00.000Z");
const streamId = "stream-test-1";

function baseReservation(
  status: InferenceBudgetReservationSnapshotV1["status"],
): InferenceBudgetReservationSnapshotV1 {
  return {
    id: "ibr-stream-test" as InferenceBudgetReservationSnapshotV1["id"],
    workspaceId,
    reservationKey:
      "ibrk-stream" as InferenceBudgetReservationSnapshotV1["reservationKey"],
    inferenceInvocationId:
      "iiv-stream-test" as InferenceBudgetReservationSnapshotV1["inferenceInvocationId"],
    providerAttemptIndex: 0,
    selectedModelProfileVersionId: mpvA,
    periodKey: "2026-02" as InferenceBudgetReservationSnapshotV1["periodKey"],
    budgetPolicyVersionId:
      "ibpv-stream" as InferenceBudgetReservationSnapshotV1["budgetPolicyVersionId"],
    pricingSnapshotId: `mpv:${mpvA}`,
    status,
    reservedUsdMicros: 500_000,
  };
}

function eventAt(
  sequence: number,
  partial: ModelStreamEvent,
): ModelStreamEvent {
  return {
    ...partial,
    streamFormatVersion: MODEL_STREAM_EVENT_FORMAT_VERSION,
    streamId,
    sequence,
  };
}

function buildPolicy(
  definition: NonNullable<InferenceRoutingRuntimePolicyV1["definition"]>,
): InferenceRoutingRuntimePolicyV1 {
  return {
    schemaVersion: "1",
    enabled: true,
    policyVersionId:
      "irpv-stream" as import("@osva-ai/contracts").InferenceRoutingPolicyVersionId,
    definition,
  };
}

function routingOptions(
  policy: InferenceRoutingRuntimePolicyV1,
): ModelGatewayGenerateTextOptions {
  return {
    routing: {
      workspaceId,
      policy,
      boundModelProfileVersionId: mpvA,
    },
  };
}

function completionRequest(): GenerateCompletionRequest {
  return {
    modelProfileVersionId: mpvA,
    messages: [{ role: "user", content: "stream-routing-test" }],
    maxOutputTokens: 128,
  };
}

async function collectStream(source: {
  [Symbol.asyncIterator]: () => AsyncIterator<ModelStreamEvent>;
}): Promise<ModelStreamEvent[]> {
  const events: ModelStreamEvent[] = [];
  for await (const event of source) {
    events.push(event);
  }
  return events;
}

async function seedProfiles(
  profiles: MemoryModelProfileRepository,
  input?: {
    readonly pricingA?: {
      inputUsdMicrosPerMillionTokens: number;
      outputUsdMicrosPerMillionTokens: number;
    };
    readonly pricingB?: {
      inputUsdMicrosPerMillionTokens: number;
      outputUsdMicrosPerMillionTokens: number;
    };
  },
): Promise<void> {
  await profiles.saveModelProfile(
    ModelProfile.create({
      id: mp1,
      workspaceId,
      key: "p",
      name: "P",
      createdAt: NOW,
    }),
  );
  await profiles.appendModelProfileVersion({
    id: mpvA,
    modelProfileId: mp1,
    provider: "OPENAI",
    model: "a",
    pricing: input?.pricingA
      ? { currency: "USD", ...input.pricingA }
      : undefined,
    createdAt: NOW,
  });
  await profiles.appendModelProfileVersion({
    id: mpvB,
    modelProfileId: mp1,
    provider: "OPENAI",
    model: "b",
    pricing: input?.pricingB
      ? { currency: "USD", ...input.pricingB }
      : undefined,
    createdAt: NOW,
  });
}

describe("RoutingModelGateway streaming fallback", () => {
  it("falls back when the first provider fails before consumer-visible output", async () => {
    const profiles = new MemoryModelProfileRepository();
    await seedProfiles(profiles);

    let attempts = 0;
    const inner = {
      generateCompletionStream: vi.fn(() => ({
        async *[Symbol.asyncIterator]() {
          attempts += 1;
          if (attempts === 1) {
            throw new ModelGatewayError(
              MODEL_ERROR_CODES.MODEL_RATE_LIMITED,
              "limited",
              { retryable: true },
            );
          }
          yield eventAt(0, {
            streamFormatVersion: MODEL_STREAM_EVENT_FORMAT_VERSION,
            streamId,
            sequence: 0,
            kind: "TEXT_DELTA",
            textDelta: "ok",
          });
          yield eventAt(1, {
            streamFormatVersion: MODEL_STREAM_EVENT_FORMAT_VERSION,
            streamId,
            sequence: 1,
            kind: "COMPLETED",
            finishReason: "stop",
          });
        },
      })),
    };

    const decisions: unknown[] = [];
    const gateway = new RoutingModelGateway({
      inner: inner as never,
      modelProfiles: profiles,
      persistDecision: async (decision) => {
        decisions.push(decision);
      },
    });

    const events = await collectStream(
      gateway.generateCompletionStream(
        completionRequest(),
        routingOptions(
          buildPolicy({
            schemaVersion: "1",
            strategy: "PRIORITY_WITH_FALLBACK",
            candidateModelProfileVersionIds: [mpvA, mpvB],
            allowFallback: true,
            maxProviderAttempts: 2,
          }),
        ),
      ),
    );

    expect(attempts).toBe(2);
    expect(events.map((e) => e.kind)).toEqual(["TEXT_DELTA", "COMPLETED"]);
    expect(inner.generateCompletionStream).toHaveBeenCalledTimes(2);
    const streamCalls = inner.generateCompletionStream.mock
      .calls as unknown as Array<[GenerateCompletionRequest]>;
    expect(streamCalls[1]?.[0]?.modelProfileVersionId).toBe(mpvB);
    expect(decisions).toHaveLength(1);
    const decision = decisions[0] as {
      providerAttemptCount: number;
      selectedModelProfileVersionId: string;
    };
    expect(decision.providerAttemptCount).toBe(2);
    expect(decision.selectedModelProfileVersionId).toBe(mpvB);
  });

  it("does not fallback after consumer-visible output", async () => {
    const profiles = new MemoryModelProfileRepository();
    await seedProfiles(profiles);

    const inner = {
      generateCompletionStream: vi.fn(() => ({
        async *[Symbol.asyncIterator]() {
          yield eventAt(0, {
            streamFormatVersion: MODEL_STREAM_EVENT_FORMAT_VERSION,
            streamId,
            sequence: 0,
            kind: "TEXT_DELTA",
            textDelta: "partial",
          });
          yield eventAt(1, {
            streamFormatVersion: MODEL_STREAM_EVENT_FORMAT_VERSION,
            streamId,
            sequence: 1,
            kind: "FAILED",
            code: MODEL_ERROR_CODES.MODEL_PROVIDER_ERROR,
            message: "mid",
            retryable: true,
          });
        },
      })),
    };

    const gateway = new RoutingModelGateway({
      inner: inner as never,
      modelProfiles: profiles,
    });

    await expect(
      collectStream(
        gateway.generateCompletionStream(
          completionRequest(),
          routingOptions(
            buildPolicy({
              schemaVersion: "1",
              strategy: "PRIORITY_WITH_FALLBACK",
              candidateModelProfileVersionIds: [mpvA, mpvB],
              allowFallback: true,
              maxProviderAttempts: 2,
            }),
          ),
        ),
      ),
    ).rejects.toMatchObject({
      code: MODEL_ERROR_CODES.MODEL_PROVIDER_ERROR,
    });
    expect(inner.generateCompletionStream).toHaveBeenCalledTimes(1);
  });

  it("does not fallback on non-retryable errors", async () => {
    const profiles = new MemoryModelProfileRepository();
    await seedProfiles(profiles);

    const inner = {
      generateCompletionStream: vi.fn(() => ({
        async *[Symbol.asyncIterator]() {
          throw new ModelGatewayError(
            MODEL_ERROR_CODES.MODEL_AUTHENTICATION_ERROR,
            "auth",
            { retryable: false },
          );
        },
      })),
    };

    const gateway = new RoutingModelGateway({
      inner: inner as never,
      modelProfiles: profiles,
    });

    await expect(
      collectStream(
        gateway.generateCompletionStream(
          completionRequest(),
          routingOptions(
            buildPolicy({
              schemaVersion: "1",
              strategy: "PRIORITY_WITH_FALLBACK",
              candidateModelProfileVersionIds: [mpvA, mpvB],
              allowFallback: true,
              maxProviderAttempts: 2,
            }),
          ),
        ),
      ),
    ).rejects.toMatchObject({
      code: MODEL_ERROR_CODES.MODEL_AUTHENTICATION_ERROR,
    });
    expect(inner.generateCompletionStream).toHaveBeenCalledTimes(1);
  });

  it("honors allowFallback false and maxProviderAttempts", async () => {
    const profiles = new MemoryModelProfileRepository();
    await seedProfiles(profiles);

    let calls = 0;
    const inner = {
      generateCompletionStream: vi.fn(() => ({
        async *[Symbol.asyncIterator]() {
          calls += 1;
          throw new ModelGatewayError(
            MODEL_ERROR_CODES.MODEL_RATE_LIMITED,
            "limited",
            { retryable: true },
          );
        },
      })),
    };

    const gateway = new RoutingModelGateway({
      inner: inner as never,
      modelProfiles: profiles,
    });

    await expect(
      collectStream(
        gateway.generateCompletionStream(
          completionRequest(),
          routingOptions(
            buildPolicy({
              schemaVersion: "1",
              strategy: "PRIORITY_WITH_FALLBACK",
              candidateModelProfileVersionIds: [mpvA, mpvB],
              allowFallback: false,
              maxProviderAttempts: 3,
            }),
          ),
        ),
      ),
    ).rejects.toThrow();

    expect(calls).toBe(1);
  });

  it("forwards provider attempt index into budget context on stream fallback", async () => {
    const profiles = new MemoryModelProfileRepository();
    await seedProfiles(profiles);

    const reservation = baseReservation("ADMITTED");
    const admission: InferenceBudgetAdmissionPort = {
      admitOrGetExisting: vi.fn(
        async (): Promise<InferenceBudgetAdmissionOutcomeV1> => ({
          outcome: "ADMITTED",
          reservation,
          periodLedgerAfter: {
            workspaceId,
            period: {
              periodKind: "CALENDAR_MONTH_UTC",
              periodKey: reservation.periodKey,
              periodStartUtc: "2026-02-01T00:00:00.000Z",
              periodEndExclusiveUtc: "2026-03-01T00:00:00.000Z",
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
      reconcile: vi.fn(),
    } as unknown as InferenceBudgetAdmissionPort;

    const budgetBinding: TrustedModelGatewayBudgetBindingV1 = {
      enforcement: "ENABLED",
      workspaceId,
      admission,
      runtimePolicy: {
        schemaVersion: "1",
        enabled: true,
        policyVersionId:
          "ibpv-stream" as import("@osva-ai/contracts").InferenceBudgetPolicyVersionId,
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
            "rat-stream" as import("@osva-ai/contracts").RunAttemptId,
          executionGeneration: 1,
          bindingName: "main",
          modelInvocationOrdinal: 0,
        },
      },
      periodKey:
        "2026-02" as import("@osva-ai/contracts").InferenceBudgetPeriodKeyV1,
      pricingSnapshotId: `mpv:${mpvA}`,
      invocationKind: "SYNC",
      providerAttemptIndex: 0,
      selectedModelProfileVersionId: mpvA,
    };

    let attempts = 0;
    const attemptOptions: Array<ModelGatewayGenerateTextOptions | undefined> =
      [];
    const inner = {
      generateCompletionStream: vi.fn(
        (
          _req: GenerateCompletionRequest,
          opts?: ModelGatewayGenerateTextOptions,
        ) => {
          attemptOptions.push(opts);
          return {
            async *[Symbol.asyncIterator]() {
              attempts += 1;
              if (attempts === 1) {
                throw new ModelGatewayError(
                  MODEL_ERROR_CODES.MODEL_RATE_LIMITED,
                  "limited",
                  { retryable: true },
                );
              }
              yield eventAt(0, {
                streamFormatVersion: MODEL_STREAM_EVENT_FORMAT_VERSION,
                streamId,
                sequence: 0,
                kind: "TEXT_DELTA",
                textDelta: "ok",
              });
              yield eventAt(1, {
                streamFormatVersion: MODEL_STREAM_EVENT_FORMAT_VERSION,
                streamId,
                sequence: 1,
                kind: "COMPLETED",
                finishReason: "stop",
              });
            },
          };
        },
      ),
    };

    const gateway = new RoutingModelGateway({
      inner: inner as never,
      modelProfiles: profiles,
    });

    await collectStream(
      gateway.generateCompletionStream(completionRequest(), {
        ...routingOptions(
          buildPolicy({
            schemaVersion: "1",
            strategy: "PRIORITY_WITH_FALLBACK",
            candidateModelProfileVersionIds: [mpvA, mpvB],
            allowFallback: true,
            maxProviderAttempts: 2,
          }),
        ),
        budget: budgetBinding,
      }),
    );

    expect(attemptOptions[1]?.budget).toEqual(
      expect.objectContaining({
        providerAttemptIndex: 1,
        selectedModelProfileVersionId: mpvB,
      }),
    );
  });

  it("records fallback candidate cost estimates on non-stream success", async () => {
    const profiles = new MemoryModelProfileRepository();
    await seedProfiles(profiles, {
      pricingA: {
        inputUsdMicrosPerMillionTokens: 10_000_000,
        outputUsdMicrosPerMillionTokens: 20_000_000,
      },
      pricingB: {
        inputUsdMicrosPerMillionTokens: 100_000,
        outputUsdMicrosPerMillionTokens: 200_000,
      },
    });

    let calls = 0;
    const inner = {
      generateTextOutcome: vi.fn(async () => {
        calls += 1;
        if (calls === 1) {
          throw new ModelGatewayError(
            MODEL_ERROR_CODES.MODEL_RATE_LIMITED,
            "limited",
            { retryable: true },
          );
        }
        return { text: "ok" };
      }),
    };

    const decisions: unknown[] = [];
    const gateway = new RoutingModelGateway({
      inner: inner as never,
      modelProfiles: profiles,
      persistDecision: async (d) => {
        decisions.push(d);
      },
    });

    await gateway.generateTextOutcome(
      {
        modelProfileVersionId: mpvA,
        messages: [{ role: "user", content: "hello" }],
      },
      routingOptions(
        buildPolicy({
          schemaVersion: "1",
          strategy: "PRIORITY_WITH_FALLBACK",
          candidateModelProfileVersionIds: [mpvA, mpvB],
          allowFallback: true,
          maxProviderAttempts: 2,
        }),
      ),
    );

    const decision = decisions[0] as {
      estimatedCost: { estimatedCostUsdMicros: number | null };
      attempts: Array<{ estimatedCostUsdMicros: number | null }>;
      selectedModelProfileVersionId: string;
    };
    const primaryAttemptCost = decision.attempts[0]?.estimatedCostUsdMicros;
    const fallbackAttemptCost = decision.attempts[1]?.estimatedCostUsdMicros;
    expect(primaryAttemptCost).not.toBeNull();
    expect(fallbackAttemptCost).not.toBeNull();
    expect(primaryAttemptCost!).toBeGreaterThan(fallbackAttemptCost!);
    expect(decision.estimatedCost.estimatedCostUsdMicros).toBe(
      fallbackAttemptCost,
    );
    expect(decision.selectedModelProfileVersionId).toBe(mpvB);
  });
});
