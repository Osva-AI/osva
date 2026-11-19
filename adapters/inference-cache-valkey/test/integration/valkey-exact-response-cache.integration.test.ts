import { Redis } from "ioredis";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { ModelProfileVersionId, WorkspaceId } from "@osva-ai/contracts";
import { buildInferenceCacheIdentity } from "@osva/domain";
import {
  startValkeyForTests,
  stopValkeyForTests,
  type ValkeyTestContext,
} from "../../../bullmq/test/integration/valkey-harness.js";

import { ValkeyExactResponseCache } from "../../src/index.js";

const WORKSPACE_A = "ws_integaaaaaaaaaa" as WorkspaceId;
const WORKSPACE_B = "ws_integbbbbbbbbbb" as WorkspaceId;

describe("Valkey exact-response cache integration", () => {
  let valkey: ValkeyTestContext;
  let cache: ValkeyExactResponseCache;

  beforeAll(async () => {
    valkey = await startValkeyForTests();
    cache = new ValkeyExactResponseCache({ url: valkey.url });
  }, 180_000);

  afterAll(async () => {
    await cache.close();
    await stopValkeyForTests(valkey);
  }, 60_000);

  function identity(workspaceId: WorkspaceId, suffix: string) {
    const built = buildInferenceCacheIdentity({
      workspaceId,
      material: {
        modelProfileVersionId: "mpv_integaaaaaaaaaa" as ModelProfileVersionId,
        provider: "OPENAI",
        configuredModelId: "gpt-test",
        messages: [{ role: "user", content: `${suffix}-${workspaceId}` }],
      },
    });
    if (built === undefined) {
      throw new Error("identity");
    }
    return built;
  }

  it("performs write/read round trip on real Valkey", async () => {
    const { storageKey, identityDigest } = identity(WORKSPACE_A, "round-trip");
    const now = new Date().toISOString();
    await expect(
      cache.putIfAbsent({
        workspaceId: WORKSPACE_A,
        storageKey,
        identityDigest,
        ttlSeconds: 300,
        entry: {
          identityDigest,
          cachedAt: now,
          body: { text: "integration-ok" },
        },
      }),
    ).resolves.toEqual({ outcome: "created" });

    await expect(
      cache.lookup({ workspaceId: WORKSPACE_A, storageKey, identityDigest }),
    ).resolves.toMatchObject({
      outcome: "hit",
      entry: { body: { text: "integration-ok" } },
    });
  });

  it("enforces NX semantics under concurrency", async () => {
    const { storageKey, identityDigest } = identity(WORKSPACE_A, "nx-race");
    const entry = {
      identityDigest,
      cachedAt: new Date().toISOString(),
      body: { text: "race" },
    };
    const request = {
      workspaceId: WORKSPACE_A,
      storageKey,
      identityDigest,
      ttlSeconds: 300,
      entry,
    };

    const results = await Promise.all([
      cache.putIfAbsent(request),
      cache.putIfAbsent(request),
    ]);
    expect(results.filter((r) => r.outcome === "created").length).toBe(1);
    expect(results.filter((r) => r.outcome === "exists").length).toBe(1);
  });

  it("isolates workspaces on real Valkey", async () => {
    const a = identity(WORKSPACE_A, "iso-a");
    const b = identity(WORKSPACE_B, "iso-b");

    await cache.putIfAbsent({
      workspaceId: WORKSPACE_A,
      storageKey: a.storageKey,
      identityDigest: a.identityDigest,
      ttlSeconds: 300,
      entry: {
        identityDigest: a.identityDigest,
        cachedAt: new Date().toISOString(),
        body: { text: "ws-a" },
      },
    });

    await expect(
      cache.lookup({
        workspaceId: WORKSPACE_B,
        storageKey: b.storageKey,
        identityDigest: b.identityDigest,
      }),
    ).resolves.toEqual({ outcome: "miss" });
  });

  it("expires entries by TTL", async () => {
    const { storageKey, identityDigest } = identity(WORKSPACE_A, "ttl-expire");
    await cache.putIfAbsent({
      workspaceId: WORKSPACE_A,
      storageKey,
      identityDigest,
      ttlSeconds: 60,
      entry: {
        identityDigest,
        cachedAt: new Date().toISOString(),
        body: { text: "short-lived" },
      },
    });

    const redis = new Redis(valkey.url, { maxRetriesPerRequest: 1 });
    try {
      await redis.expire(storageKey, 1);
      await new Promise((resolve) => setTimeout(resolve, 1_500));
      await expect(
        cache.lookup({ workspaceId: WORKSPACE_A, storageKey, identityDigest }),
      ).resolves.toEqual({ outcome: "miss" });
    } finally {
      await redis.quit();
    }
  });

  it("classifies corrupt wire values", async () => {
    const { storageKey, identityDigest } = identity(WORKSPACE_A, "corrupt");
    const redis = new Redis(valkey.url, { maxRetriesPerRequest: 1 });
    try {
      await redis.set(storageKey, "{corrupt", "EX", 60);
      await expect(
        cache.lookup({ workspaceId: WORKSPACE_A, storageKey, identityDigest }),
      ).resolves.toEqual({ outcome: "corrupt", identityDigest });
    } finally {
      await redis.quit();
    }
  });
});
