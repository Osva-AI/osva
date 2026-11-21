import type {
  ModelProfileId,
  ModelProfileVersionId,
  WorkspaceId,
} from "@osva-ai/contracts";
import { ModelProfileVersion } from "../src/model-profile-version.js";
import { describe, expect, it } from "vitest";

import {
  InferenceRoutingCircuitBreakerRegistry,
  InferenceRoutingLatencyStore,
  selectInferenceRoute,
} from "../src/inference-routing/index.js";

const workspaceId = "ws-route" as WorkspaceId;
const mp1 = "mp-1" as ModelProfileId;
const mpvCheap = "mpv-cheap" as ModelProfileVersionId;
const mpvExpensive = "mpv-expensive" as ModelProfileVersionId;

const cheap = ModelProfileVersion.create({
  id: mpvCheap,
  modelProfileId: mp1,
  version: 1,
  provider: "OPENAI",
  model: "cheap-model",
  pricing: {
    currency: "USD",
    inputUsdMicrosPerMillionTokens: 100,
    outputUsdMicrosPerMillionTokens: 200,
  },
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
});

const expensive = ModelProfileVersion.create({
  id: mpvExpensive,
  modelProfileId: mp1,
  version: 2,
  provider: "ANTHROPIC",
  model: "expensive-model",
  pricing: {
    currency: "USD",
    inputUsdMicrosPerMillionTokens: 5_000,
    outputUsdMicrosPerMillionTokens: 10_000,
  },
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
});

describe("inference routing selection", () => {
  it("selects cheapest eligible candidate when priced", async () => {
    const latencyStore = new InferenceRoutingLatencyStore();
    const result = await selectInferenceRoute({
      workspaceId,
      policy: {
        schemaVersion: "1",
        strategy: "LOWEST_ESTIMATED_COST",
        candidateModelProfileVersionIds: [mpvExpensive, mpvCheap],
      },
      messages: [{ role: "user", content: "hello" }],
      maxOutputTokens: 100,
      hasToolDefinitions: false,
      hasJsonSchema: false,
      requiresStreaming: false,
      resolveVersion: async (id) => {
        if (id === mpvCheap) return cheap;
        if (id === mpvExpensive) return expensive;
        return null;
      },
      authorizeWorkspace: async () => true,
      connectionResolvable: async () => true,
      latencyStore,
      atMs: Date.now(),
    });

    expect(result.primary.modelProfileVersionId).toBe(mpvCheap);
    expect(result.primary.reason).toBe("LOWEST_ESTIMATED_COST");
  });

  it("excludes models missing tool-call capability", async () => {
    await expect(
      selectInferenceRoute({
        workspaceId,
        policy: {
          schemaVersion: "1",
          strategy: "FIXED",
          candidateModelProfileVersionIds: [mpvCheap],
          capabilityRequirements: {
            requiresToolCalling: true,
          },
        },
        messages: [{ role: "user", content: "hello" }],
        maxOutputTokens: 100,
        hasToolDefinitions: true,
        hasJsonSchema: false,
        requiresStreaming: false,
        resolveVersion: async () => cheap,
        authorizeWorkspace: async () => true,
        connectionResolvable: async () => true,
        atMs: Date.now(),
      }),
    ).resolves.toBeDefined();

    const geminiOnly = ModelProfileVersion.create({
      ...expensive,
      id: "mpv-gemini" as ModelProfileVersionId,
      provider: "GOOGLE_GEMINI",
    });

    await expect(
      selectInferenceRoute({
        workspaceId,
        policy: {
          schemaVersion: "1",
          strategy: "FIXED",
          candidateModelProfileVersionIds: [geminiOnly.id],
          allowedProviders: ["OPENAI"],
        },
        messages: [{ role: "user", content: "hello" }],
        maxOutputTokens: 100,
        hasToolDefinitions: false,
        hasJsonSchema: false,
        requiresStreaming: false,
        resolveVersion: async () => geminiOnly,
        authorizeWorkspace: async () => true,
        connectionResolvable: async () => true,
        atMs: Date.now(),
      }),
    ).rejects.toThrow();
  });

  it("opens circuit after retryable failures", () => {
    const breaker = new InferenceRoutingCircuitBreakerRegistry({
      failureThreshold: 2,
      windowMs: 60_000,
      openDurationMs: 1_000,
    });
    const at = 1_000;
    breaker.observe({
      workspaceId,
      modelProfileVersionId: mpvCheap,
      success: false,
      retryable: true,
      atMs: at,
    });
    breaker.observe({
      workspaceId,
      modelProfileVersionId: mpvCheap,
      success: false,
      retryable: true,
      atMs: at + 1,
    });
    expect(
      breaker.isEligible({
        workspaceId,
        modelProfileVersionId: mpvCheap,
        atMs: at + 2,
      }),
    ).toBe(false);
  });

  it("fails closed when workspace authorization fails", async () => {
    await expect(
      selectInferenceRoute({
        workspaceId,
        policy: {
          schemaVersion: "1",
          strategy: "FIXED",
          candidateModelProfileVersionIds: [mpvCheap],
        },
        messages: [{ role: "user", content: "hello" }],
        maxOutputTokens: 100,
        hasToolDefinitions: false,
        hasJsonSchema: false,
        requiresStreaming: false,
        resolveVersion: async () => cheap,
        authorizeWorkspace: async () => false,
        connectionResolvable: async () => true,
        atMs: Date.now(),
      }),
    ).rejects.toThrow();
  });
});
