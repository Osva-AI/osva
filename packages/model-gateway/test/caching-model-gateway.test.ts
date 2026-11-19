import type {
  ExactResponseCacheEntry,
  ExactResponseCacheLookupRequest,
  ExactResponseCacheLookupResult,
  ExactResponseCachePort,
  ExactResponseCachePutRequest,
  ExactResponseCachePutResult,
  ModelProfileId,
  ModelProfileVersionId,
  ModelProviderConnectionVersionId,
  WorkspaceId,
} from "@osva-ai/contracts";
import {
  INFERENCE_MODEL_INVOCATION_SOURCES,
  MODEL_ERROR_CODES,
} from "@osva-ai/contracts";
import { MemoryModelProfileRepository } from "@osva/adapters-memory";
import { ModelProfile, ModelProfileVersion } from "@osva/domain";
import { describe, expect, it, vi } from "vitest";

import { ModelGatewayError } from "../src/errors.js";
import { CachingModelGateway } from "../src/caching-model-gateway.js";
import { ModelGateway } from "../src/model-gateway.js";
import type {
  ModelProviderAdapter,
  ResolvedProviderGenerateTextRequest,
} from "../src/provider-adapter.js";

const NOW = new Date("2026-01-15T12:00:00.000Z");
const workspaceId = "ws-1" as WorkspaceId;
const profileId = "mp-1" as ModelProfileId;
const versionId = "mpv-1" as ModelProfileVersionId;
const connectionId = "conn-v1" as ModelProviderConnectionVersionId;

const cachePolicy = {
  schemaVersion: "1" as const,
  enabled: true,
  determinism: "REQUIRED_DETERMINISTIC" as const,
};

class MemoryExactResponseCache implements ExactResponseCachePort {
  readonly store = new Map<string, ExactResponseCacheEntry>();
  lookupCalls = 0;
  putCalls = 0;
  unauthorized = false;
  unavailable = false;
  encryptionFailure = false;
  putFails = false;

  async lookup(
    request: ExactResponseCacheLookupRequest,
  ): Promise<ExactResponseCacheLookupResult> {
    this.lookupCalls += 1;
    if (this.unavailable) {
      return { outcome: "bypass", reason: "INFRASTRUCTURE_UNAVAILABLE" };
    }
    if (this.unauthorized) {
      return { outcome: "bypass", reason: "UNAUTHORIZED" };
    }
    if (this.encryptionFailure) {
      return { outcome: "bypass", reason: "ENCRYPTION_FAILURE" };
    }
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
    this.putCalls += 1;
    if (this.putFails) {
      return { outcome: "bypass", reason: "INFRASTRUCTURE_UNAVAILABLE" };
    }
    if (this.unavailable) {
      return { outcome: "bypass", reason: "INFRASTRUCTURE_UNAVAILABLE" };
    }
    if (this.store.has(request.storageKey)) {
      return { outcome: "exists" };
    }
    this.store.set(request.storageKey, request.entry);
    return { outcome: "created" };
  }
}

async function seedDeterministicProfile(
  repository: MemoryModelProfileRepository,
  model = "gpt-test",
): Promise<void> {
  await repository.saveModelProfile(
    ModelProfile.create({
      id: profileId,
      workspaceId,
      key: "primary",
      name: "Primary",
      createdAt: NOW,
    }),
  );
  await repository.saveModelProfileVersion(
    ModelProfileVersion.create({
      id: versionId,
      modelProfileId: profileId,
      version: 1,
      provider: "OPENAI",
      model,
      modelProviderConnectionVersionId: connectionId,
      createdAt: NOW,
    }),
  );
}

function createStack(input: {
  readonly cache?: MemoryExactResponseCache;
  readonly provider: ModelProviderAdapter;
}) {
  const modelProfiles = new MemoryModelProfileRepository();
  return {
    modelProfiles,
    cache: input.cache,
    gateway: new CachingModelGateway({
      inner: new ModelGateway({
        modelProfiles,
        providers: { OPENAI: input.provider },
      }),
      modelProfiles,
      cache: input.cache,
    }),
  };
}

describe("CachingModelGateway", () => {
  it("delegates to provider when cache layer is disabled", async () => {
    const provider: ModelProviderAdapter = {
      generateText: vi.fn(async () => ({ text: "provider" })),
    };
    const { gateway, modelProfiles } = createStack({ provider });
    await seedDeterministicProfile(modelProfiles);

    const result = await gateway.generateText({
      modelProfileVersionId: versionId,
      messages: [{ role: "user", content: "hello" }],
    });

    expect(result).toEqual({ text: "provider" });
    expect(provider.generateText).toHaveBeenCalledTimes(1);
  });

  it("writes on miss and serves hits without provider calls", async () => {
    const provider: ModelProviderAdapter = {
      generateText: vi.fn(async () => ({
        text: "provider",
        finishReason: "stop" as const,
        usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
      })),
    };
    const cache = new MemoryExactResponseCache();
    const { gateway, modelProfiles } = createStack({ cache, provider });
    await seedDeterministicProfile(modelProfiles);

    const options = {
      cache: {
        workspaceId,
        executionPurpose: "AGENT_RUN" as const,
        policy: cachePolicy,
      },
    };
    const request = {
      modelProfileVersionId: versionId,
      messages: [{ role: "user" as const, content: "hello" }],
    };

    const first = await gateway.generateTextOutcome(request, options);
    expect(first.invocationSource).toBe(INFERENCE_MODEL_INVOCATION_SOURCES[0]);
    expect(provider.generateText).toHaveBeenCalledTimes(1);
    expect(cache.putCalls).toBe(1);

    const second = await gateway.generateTextOutcome(request, options);
    expect(second.invocationSource).toBe(INFERENCE_MODEL_INVOCATION_SOURCES[2]);
    expect(second.text).toBe("provider");
    expect(provider.generateText).toHaveBeenCalledTimes(1);
  });

  it("fails closed on unauthorized cache lookup", async () => {
    const cache = new MemoryExactResponseCache();
    cache.unauthorized = true;
    const provider: ModelProviderAdapter = {
      generateText: vi.fn(async () => ({ text: "provider" })),
    };
    const { gateway, modelProfiles } = createStack({ cache, provider });
    await seedDeterministicProfile(modelProfiles);

    await expect(
      gateway.generateTextOutcome(
        {
          modelProfileVersionId: versionId,
          messages: [{ role: "user", content: "hello" }],
        },
        {
          cache: {
            workspaceId,
            executionPurpose: "AGENT_RUN",
            policy: cachePolicy,
          },
        },
      ),
    ).rejects.toMatchObject({
      code: MODEL_ERROR_CODES.MODEL_CACHE_UNAUTHORIZED,
    });

    expect(provider.generateText).not.toHaveBeenCalled();
  });

  it("falls back to provider on encryption failure without serving stale cache", async () => {
    const cache = new MemoryExactResponseCache();
    cache.encryptionFailure = true;
    const provider: ModelProviderAdapter = {
      generateText: vi.fn(async () => ({ text: "provider" })),
    };
    const { gateway, modelProfiles } = createStack({ cache, provider });
    await seedDeterministicProfile(modelProfiles);

    const outcome = await gateway.generateTextOutcome(
      {
        modelProfileVersionId: versionId,
        messages: [{ role: "user", content: "hello" }],
      },
      {
        cache: {
          workspaceId,
          executionPurpose: "AGENT_RUN",
          policy: cachePolicy,
        },
      },
    );

    expect(outcome.text).toBe("provider");
    expect(provider.generateText).toHaveBeenCalledTimes(1);
  });

  it("skips cache lookup for evaluation judge execution purpose", async () => {
    const cache = new MemoryExactResponseCache();
    const provider: ModelProviderAdapter = {
      generateText: vi.fn(async () => ({ text: "provider" })),
    };
    const { gateway, modelProfiles } = createStack({ cache, provider });
    await seedDeterministicProfile(modelProfiles);

    await gateway.generateTextOutcome(
      {
        modelProfileVersionId: versionId,
        messages: [{ role: "user", content: "hello" }],
      },
      {
        cache: {
          workspaceId,
          executionPurpose: "EVALUATION_JUDGE",
          policy: cachePolicy,
        },
      },
    );

    expect(cache.lookupCalls).toBe(0);
    expect(cache.putCalls).toBe(0);
    expect(provider.generateText).toHaveBeenCalledTimes(1);
  });

  it("falls back to provider when cache infrastructure is unavailable", async () => {
    const cache = new MemoryExactResponseCache();
    cache.unavailable = true;
    const provider: ModelProviderAdapter = {
      generateText: vi.fn(async () => ({ text: "provider" })),
    };
    const { gateway, modelProfiles } = createStack({ cache, provider });
    await seedDeterministicProfile(modelProfiles);

    const outcome = await gateway.generateTextOutcome(
      {
        modelProfileVersionId: versionId,
        messages: [{ role: "user", content: "hello" }],
      },
      {
        cache: {
          workspaceId,
          executionPurpose: "AGENT_RUN",
          policy: cachePolicy,
        },
      },
    );

    expect(outcome.text).toBe("provider");
    expect(provider.generateText).toHaveBeenCalledTimes(1);
  });

  it("does not call provider when aborted before cache lookup", async () => {
    const cache = new MemoryExactResponseCache();
    const provider: ModelProviderAdapter = {
      generateText: vi.fn(async () => ({ text: "provider" })),
    };
    const { gateway, modelProfiles } = createStack({ cache, provider });
    await seedDeterministicProfile(modelProfiles);
    const controller = new AbortController();
    controller.abort();

    await expect(
      gateway.generateTextOutcome(
        {
          modelProfileVersionId: versionId,
          messages: [{ role: "user", content: "hello" }],
        },
        {
          signal: controller.signal,
          cache: {
            workspaceId,
            executionPurpose: "AGENT_RUN",
            policy: cachePolicy,
          },
        },
      ),
    ).rejects.toBeInstanceOf(ModelGatewayError);

    expect(provider.generateText).not.toHaveBeenCalled();
  });

  it("does not store failed or empty provider responses", async () => {
    const cache = new MemoryExactResponseCache();
    const provider: ModelProviderAdapter = {
      generateText: vi.fn(async () => ({
        text: "",
        finishReason: "stop" as const,
      })),
    };
    const { gateway, modelProfiles } = createStack({ cache, provider });
    await seedDeterministicProfile(modelProfiles);

    await expect(
      gateway.generateText(
        {
          modelProfileVersionId: versionId,
          messages: [{ role: "user", content: "hello" }],
        },
        {
          cache: {
            workspaceId,
            executionPurpose: "AGENT_RUN",
            policy: cachePolicy,
          },
        },
      ),
    ).rejects.toBeInstanceOf(ModelGatewayError);

    expect(cache.putCalls).toBe(0);
  });

  it("bypasses cache for evaluation judge purpose", async () => {
    const cache = new MemoryExactResponseCache();
    const seen: ResolvedProviderGenerateTextRequest[] = [];
    const provider: ModelProviderAdapter = {
      generateText: async (request) => {
        seen.push(request);
        return { text: "provider" };
      },
    };
    const { gateway, modelProfiles } = createStack({ cache, provider });
    await seedDeterministicProfile(modelProfiles);

    await gateway.generateTextOutcome(
      {
        modelProfileVersionId: versionId,
        messages: [{ role: "user", content: "hello" }],
      },
      {
        cache: {
          workspaceId,
          executionPurpose: "EVALUATION_JUDGE",
          policy: cachePolicy,
        },
      },
    );

    expect(seen).toHaveLength(1);
    expect(cache.lookupCalls).toBe(0);
  });

  it("does not use cache when policy is disabled or non-deterministic", async () => {
    const cache = new MemoryExactResponseCache();
    const provider: ModelProviderAdapter = {
      generateText: vi.fn(async () => ({ text: "provider" })),
    };
    const { gateway, modelProfiles } = createStack({ cache, provider });
    await seedDeterministicProfile(modelProfiles);
    const request = {
      modelProfileVersionId: versionId,
      messages: [{ role: "user" as const, content: "hello" }],
    };

    await gateway.generateTextOutcome(request, {
      cache: {
        workspaceId,
        executionPurpose: "AGENT_RUN",
        policy: { ...cachePolicy, enabled: false },
      },
    });
    await gateway.generateTextOutcome(request, {
      cache: {
        workspaceId,
        executionPurpose: "AGENT_RUN",
        policy: {
          ...cachePolicy,
          determinism: "PROVIDER_DEFAULT",
        },
      },
    });

    expect(provider.generateText).toHaveBeenCalledTimes(2);
    expect(cache.lookupCalls).toBe(0);
  });

  it("isolates cache keys by workspace, profile, connection, and content", async () => {
    const cache = new MemoryExactResponseCache();
    const provider: ModelProviderAdapter = {
      generateText: vi.fn(async () => ({
        text: "provider",
        finishReason: "stop" as const,
      })),
    };
    const { gateway, modelProfiles } = createStack({ cache, provider });
    await seedDeterministicProfile(modelProfiles);

    const baseOptions = {
      cache: {
        workspaceId,
        executionPurpose: "AGENT_RUN" as const,
        policy: cachePolicy,
      },
    };
    const baseRequest = {
      modelProfileVersionId: versionId,
      messages: [{ role: "user" as const, content: "hello" }],
    };

    await gateway.generateTextOutcome(baseRequest, baseOptions);
    expect(provider.generateText).toHaveBeenCalledTimes(1);

    await gateway.generateTextOutcome(baseRequest, baseOptions);
    expect(provider.generateText).toHaveBeenCalledTimes(1);

    await gateway.generateTextOutcome(
      {
        ...baseRequest,
        messages: [{ role: "user" as const, content: "other" }],
      },
      baseOptions,
    );
    expect(provider.generateText).toHaveBeenCalledTimes(2);

    await gateway.generateTextOutcome(baseRequest, {
      cache: {
        ...baseOptions.cache,
        workspaceId: "ws-2" as WorkspaceId,
      },
    });
    expect(provider.generateText).toHaveBeenCalledTimes(3);
  });

  it("re-invokes provider for corrupt cache entries", async () => {
    const cache = new MemoryExactResponseCache();
    const provider: ModelProviderAdapter = {
      generateText: vi.fn(async () => ({
        text: "fresh",
        finishReason: "stop" as const,
      })),
    };
    const { gateway, modelProfiles } = createStack({ cache, provider });
    await seedDeterministicProfile(modelProfiles);

    const request = {
      modelProfileVersionId: versionId,
      messages: [{ role: "user" as const, content: "hello" }],
    };
    const options = {
      cache: {
        workspaceId,
        executionPurpose: "AGENT_RUN" as const,
        policy: cachePolicy,
      },
    };

    await gateway.generateTextOutcome(request, options);
    const key = [...cache.store.keys()][0];
    if (key !== undefined) {
      const entry = cache.store.get(key)!;
      cache.store.set(key, {
        ...entry,
        identityDigest: "sha256:deadbeef",
      });
    }

    const outcome = await gateway.generateTextOutcome(request, options);
    expect(outcome.text).toBe("fresh");
    expect(provider.generateText).toHaveBeenCalledTimes(2);
  });

  it("preserves provider success when cache write fails", async () => {
    const cache = new MemoryExactResponseCache();
    cache.putFails = true;
    const provider: ModelProviderAdapter = {
      generateText: vi.fn(async () => ({
        text: "provider",
        finishReason: "stop" as const,
      })),
    };
    const { gateway, modelProfiles } = createStack({ cache, provider });
    await seedDeterministicProfile(modelProfiles);

    const outcome = await gateway.generateTextOutcome(
      {
        modelProfileVersionId: versionId,
        messages: [{ role: "user" as const, content: "hello" }],
      },
      {
        cache: {
          workspaceId,
          executionPurpose: "AGENT_RUN",
          policy: cachePolicy,
        },
      },
    );

    expect(outcome.text).toBe("provider");
    expect(cache.store.size).toBe(0);
  });
});
