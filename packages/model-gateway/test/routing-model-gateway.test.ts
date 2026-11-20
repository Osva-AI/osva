import type {
  GenerateTextRequest,
  InferenceRoutingRuntimePolicyV1,
  ModelProfileId,
  ModelProfileVersionId,
  WorkspaceId,
} from "@osva-ai/contracts";
import { MODEL_ERROR_CODES } from "@osva-ai/contracts";
import { MemoryModelProfileRepository } from "@osva/adapters-memory";
import { ModelProfile } from "@osva/domain";
import { describe, expect, it, vi } from "vitest";

import { ModelGatewayError } from "../src/errors.js";
import { RoutingModelGateway } from "../src/routing-model-gateway.js";
import type { ModelGatewayGenerateTextOptions } from "../src/provider-adapter.js";
import type { ProviderGenerateTextResult } from "../src/usage.js";

const workspaceId = "ws-route-gw" as WorkspaceId;
const mp1 = "mp-1" as ModelProfileId;
const mpvA = "mpv-a" as ModelProfileVersionId;
const mpvB = "mpv-b" as ModelProfileVersionId;
const NOW = new Date("2026-02-01T00:00:00.000Z");

function buildPolicy(
  definition: NonNullable<InferenceRoutingRuntimePolicyV1["definition"]>,
): InferenceRoutingRuntimePolicyV1 {
  return {
    schemaVersion: "1",
    enabled: true,
    policyVersionId:
      "irpv-1" as import("@osva-ai/contracts").InferenceRoutingPolicyVersionId,
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

describe("RoutingModelGateway", () => {
  it("does not fallback when budget is exceeded", async () => {
    const profiles = new MemoryModelProfileRepository();
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
      createdAt: NOW,
    });
    await profiles.appendModelProfileVersion({
      id: mpvB,
      modelProfileId: mp1,
      provider: "OPENAI",
      model: "b",
      createdAt: NOW,
    });

    let calls = 0;
    const inner = {
      generateTextOutcome: vi.fn(async () => {
        calls += 1;
        throw new ModelGatewayError(
          MODEL_ERROR_CODES.MODEL_INFERENCE_BUDGET_EXCEEDED,
          "budget",
          { retryable: false },
        );
      }),
    };
    const gateway = new RoutingModelGateway({
      inner: inner as never,
      modelProfiles: profiles,
    });
    const policy = buildPolicy({
      schemaVersion: "1",
      strategy: "PRIORITY_WITH_FALLBACK",
      candidateModelProfileVersionIds: [mpvA, mpvB],
      allowFallback: true,
      maxProviderAttempts: 2,
    });
    await expect(
      gateway.generateTextOutcome(
        {
          modelProfileVersionId: mpvA,
          messages: [{ role: "user", content: "hi" }],
        },
        routingOptions(policy),
      ),
    ).rejects.toMatchObject({
      code: MODEL_ERROR_CODES.MODEL_INFERENCE_BUDGET_EXCEEDED,
    });
    expect(calls).toBe(1);
  });

  it("passes through when routing is disabled", async () => {
    const inner = {
      generateTextOutcome: vi.fn(async () => ({ text: "ok" })),
    };
    const gateway = new RoutingModelGateway({
      inner: inner as never,
      modelProfiles: new MemoryModelProfileRepository(),
    });
    await gateway.generateTextOutcome({
      modelProfileVersionId: mpvA,
      messages: [{ role: "user", content: "hi" }],
    });
    expect(inner.generateTextOutcome).toHaveBeenCalledTimes(1);
  });

  it("records fallback provider attempts and persists a decision", async () => {
    const profiles = new MemoryModelProfileRepository();
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
      createdAt: NOW,
    });
    await profiles.appendModelProfileVersion({
      id: mpvB,
      modelProfileId: mp1,
      provider: "OPENAI",
      model: "b",
      createdAt: NOW,
    });

    let calls = 0;
    const inner = {
      generateTextOutcome: vi.fn(
        async (): Promise<ProviderGenerateTextResult> => {
          calls += 1;
          if (calls === 1) {
            throw new ModelGatewayError(
              MODEL_ERROR_CODES.MODEL_RATE_LIMITED,
              "limited",
              { retryable: true },
            );
          }
          return { text: "fallback-ok" };
        },
      ),
    };

    const decisions: unknown[] = [];
    const gateway = new RoutingModelGateway({
      inner: inner as never,
      modelProfiles: profiles,
      persistDecision: async (decision) => {
        decisions.push(decision);
      },
    });

    const policy = buildPolicy({
      schemaVersion: "1",
      strategy: "PRIORITY_WITH_FALLBACK",
      candidateModelProfileVersionIds: [mpvA, mpvB],
      allowFallback: true,
      maxProviderAttempts: 2,
    });

    const result = await gateway.generateTextOutcome(
      {
        modelProfileVersionId: mpvA,
        messages: [{ role: "user", content: "hello" }],
      } satisfies GenerateTextRequest,
      routingOptions(policy),
    );

    expect(result.text).toBe("fallback-ok");
    expect(inner.generateTextOutcome).toHaveBeenCalledTimes(2);
    expect(decisions).toHaveLength(1);
    expect(
      (decisions[0] as { providerAttemptCount: number }).providerAttemptCount,
    ).toBe(2);
  });

  it("does not fallback on non-retryable auth failure", async () => {
    const profiles = new MemoryModelProfileRepository();
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
      createdAt: NOW,
    });
    await profiles.appendModelProfileVersion({
      id: mpvB,
      modelProfileId: mp1,
      provider: "OPENAI",
      model: "b",
      createdAt: NOW,
    });

    const inner = {
      generateTextOutcome: vi
        .fn()
        .mockRejectedValue(
          new ModelGatewayError(
            MODEL_ERROR_CODES.MODEL_AUTHENTICATION_ERROR,
            "auth",
            { retryable: false },
          ),
        ),
    };

    const gateway = new RoutingModelGateway({
      inner: inner as never,
      modelProfiles: profiles,
    });

    const policy = buildPolicy({
      schemaVersion: "1",
      strategy: "PRIORITY_WITH_FALLBACK",
      candidateModelProfileVersionIds: [mpvA, mpvB],
      allowFallback: true,
      maxProviderAttempts: 2,
    });

    await expect(
      gateway.generateTextOutcome(
        {
          modelProfileVersionId: mpvA,
          messages: [{ role: "user", content: "hello" }],
        },
        routingOptions(policy),
      ),
    ).rejects.toThrow();

    expect(inner.generateTextOutcome).toHaveBeenCalledTimes(1);
  });

  it("still completes the run when persistDecision fails", async () => {
    const profiles = new MemoryModelProfileRepository();
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
      createdAt: NOW,
    });

    const inner = {
      generateTextOutcome: vi.fn(async () => ({ text: "ok" })),
    };

    const gateway = new RoutingModelGateway({
      inner: inner as never,
      modelProfiles: profiles,
      persistDecision: async () => {
        throw new Error("db down");
      },
    });

    const policy = buildPolicy({
      schemaVersion: "1",
      strategy: "FIXED",
      candidateModelProfileVersionIds: [mpvA],
      preferredModelProfileVersionId: mpvA,
    });

    const result = await gateway.generateTextOutcome(
      {
        modelProfileVersionId: mpvA,
        messages: [{ role: "user", content: "hi" }],
      },
      routingOptions(policy),
    );
    expect(result.text).toBe("ok");
  });
});
