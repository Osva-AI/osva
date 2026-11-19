import { describe, expect, it } from "vitest";

import type {
  InferenceCacheIdentityDigest,
  WorkspaceId,
} from "@osva-ai/contracts";
import {
  INFERENCE_CACHE_IDENTITY_DIGEST_PREFIX,
  INFERENCE_CACHE_STORAGE_KEY_PREFIX,
} from "@osva-ai/contracts";
import {
  ValkeyExactResponseCache,
  createAesGcmWireProtection,
  normalizeTtlSeconds,
  parseKeyRingFromEnv,
} from "../src/index.js";

import { FakeValkeyStringStore } from "./fake-valkey-string-store.js";
import { testIdentity } from "./test-identity.js";

const WORKSPACE_A = "ws_aaaaaaaaaaaaaaaa" as WorkspaceId;
const WORKSPACE_B = "ws_bbbbbbbbbbbbbbbb" as WorkspaceId;
function fixtures(
  workspaceId: WorkspaceId = WORKSPACE_A,
  hex: string = workspaceId === WORKSPACE_A ? "a".repeat(64) : "b".repeat(64),
) {
  return testIdentity({ workspaceId, hex });
}

describe("ValkeyExactResponseCache", () => {
  it("returns miss before write", async () => {
    const store = new FakeValkeyStringStore();
    const cache = new ValkeyExactResponseCache({ store });
    const { storageKey, identityDigest } = fixtures();

    await expect(
      cache.lookup({ workspaceId: WORKSPACE_A, storageKey, identityDigest }),
    ).resolves.toEqual({ outcome: "miss" });
  });

  it("writes and reads a round trip", async () => {
    const store = new FakeValkeyStringStore();
    const now = new Date("2026-01-01T00:00:00.000Z");
    const cache = new ValkeyExactResponseCache({ store, clock: () => now });
    const { storageKey, identityDigest } = fixtures();
    const entry = {
      identityDigest,
      cachedAt: now.toISOString(),
      body: { text: "world", finishReason: "stop" as const },
    };

    await expect(
      cache.putIfAbsent({
        workspaceId: WORKSPACE_A,
        storageKey,
        identityDigest,
        ttlSeconds: 300,
        entry,
      }),
    ).resolves.toEqual({ outcome: "created" });

    await expect(
      cache.lookup({ workspaceId: WORKSPACE_A, storageKey, identityDigest }),
    ).resolves.toEqual({
      outcome: "hit",
      entry: { identityDigest, cachedAt: now.toISOString(), body: entry.body },
    });
  });

  it("classifies conditional write exists", async () => {
    const store = new FakeValkeyStringStore();
    const cache = new ValkeyExactResponseCache({ store });
    const { storageKey, identityDigest } = fixtures();
    const entry = {
      identityDigest,
      cachedAt: new Date().toISOString(),
      body: { text: "one" },
    };
    const put = {
      workspaceId: WORKSPACE_A,
      storageKey,
      identityDigest,
      ttlSeconds: 300,
      entry,
    };
    await cache.putIfAbsent(put);
    await expect(cache.putIfAbsent(put)).resolves.toEqual({
      outcome: "exists",
    });
  });

  it("rejects cross-workspace lookups and writes", async () => {
    const store = new FakeValkeyStringStore();
    const cache = new ValkeyExactResponseCache({ store });
    const { storageKey, identityDigest } = fixtures(WORKSPACE_A);

    await expect(
      cache.lookup({
        workspaceId: WORKSPACE_B,
        storageKey,
        identityDigest,
      }),
    ).resolves.toEqual({ outcome: "bypass", reason: "UNAUTHORIZED" });

    await expect(
      cache.putIfAbsent({
        workspaceId: WORKSPACE_B,
        storageKey,
        identityDigest,
        ttlSeconds: 300,
        entry: {
          identityDigest,
          cachedAt: new Date().toISOString(),
          body: { text: "x" },
        },
      }),
    ).resolves.toEqual({ outcome: "bypass", reason: "UNAUTHORIZED" });
  });

  it("never places prompt plaintext in storage keys", () => {
    const secret = "TOP_SECRET_PROMPT";
    const built = testIdentity({
      workspaceId: WORKSPACE_A,
      hex: "c".repeat(64),
    });
    expect(built.storageKey.includes(secret)).toBe(false);
    expect(
      built.storageKey.startsWith(INFERENCE_CACHE_STORAGE_KEY_PREFIX),
    ).toBe(true);
  });

  it("rejects invalid TTL boundaries", () => {
    expect(normalizeTtlSeconds(30)).toBeUndefined();
    expect(normalizeTtlSeconds(86400 * 8)).toBeUndefined();
    expect(normalizeTtlSeconds(300)).toBe(300);
  });

  it("returns corrupt for malformed payloads", async () => {
    const store = new FakeValkeyStringStore();
    const cache = new ValkeyExactResponseCache({ store });
    const { storageKey, identityDigest } = fixtures();

    await store.setNxEx(storageKey, "not-json", 300);

    await expect(
      cache.lookup({ workspaceId: WORKSPACE_A, storageKey, identityDigest }),
    ).resolves.toEqual({ outcome: "corrupt", identityDigest });
  });

  it("returns miss after logical expiration", async () => {
    let nowMs = Date.parse("2026-01-01T00:00:00.000Z");
    const store = new FakeValkeyStringStore(() => nowMs);
    const cache = new ValkeyExactResponseCache({
      store,
      clock: () => new Date(nowMs),
    });
    const { storageKey, identityDigest } = fixtures();

    await cache.putIfAbsent({
      workspaceId: WORKSPACE_A,
      storageKey,
      identityDigest,
      ttlSeconds: 60,
      entry: {
        identityDigest,
        cachedAt: new Date(nowMs).toISOString(),
        body: { text: "expire-me" },
      },
    });

    nowMs += 61_000;
    await expect(
      cache.lookup({ workspaceId: WORKSPACE_A, storageKey, identityDigest }),
    ).resolves.toEqual({ outcome: "miss" });
  });

  it("bypasses when infrastructure is unavailable", async () => {
    const store = new FakeValkeyStringStore();
    const cache = new ValkeyExactResponseCache({ store });
    const { storageKey, identityDigest } = fixtures();
    store.failNextCommand();
    await expect(
      cache.lookup({ workspaceId: WORKSPACE_A, storageKey, identityDigest }),
    ).resolves.toEqual({
      outcome: "bypass",
      reason: "INFRASTRUCTURE_UNAVAILABLE",
    });
  });

  it("rejects mismatched identity digest on put", async () => {
    const store = new FakeValkeyStringStore();
    const cache = new ValkeyExactResponseCache({ store });
    const { storageKey, identityDigest } = fixtures();
    const otherDigest =
      `${INFERENCE_CACHE_IDENTITY_DIGEST_PREFIX}${"b".repeat(64)}` as InferenceCacheIdentityDigest;

    await expect(
      cache.putIfAbsent({
        workspaceId: WORKSPACE_A,
        storageKey,
        identityDigest,
        ttlSeconds: 300,
        entry: {
          identityDigest: otherDigest,
          cachedAt: new Date().toISOString(),
          body: { text: "x" },
        },
      }),
    ).resolves.toEqual({ outcome: "rejected", reason: "IDENTITY_INCOMPLETE" });
  });

  it("rejects tampered workspace inside stored envelope", async () => {
    const store = new FakeValkeyStringStore();
    const cache = new ValkeyExactResponseCache({ store });
    const a = fixtures(WORKSPACE_A);
    await cache.putIfAbsent({
      workspaceId: WORKSPACE_A,
      storageKey: a.storageKey,
      identityDigest: a.identityDigest,
      ttlSeconds: 300,
      entry: {
        identityDigest: a.identityDigest,
        cachedAt: new Date().toISOString(),
        body: { text: "ok" },
      },
    });

    const wire = await store.get(a.storageKey);
    if (wire === null) {
      throw new Error("expected cached wire");
    }
    const tampered = wire.replace(WORKSPACE_A, WORKSPACE_B);
    await store.del(a.storageKey);
    await store.setNxEx(a.storageKey, tampered, 300);

    await expect(
      cache.lookup({
        workspaceId: WORKSPACE_A,
        storageKey: a.storageKey,
        identityDigest: a.identityDigest,
      }),
    ).resolves.toEqual({
      outcome: "bypass",
      reason: "UNAUTHORIZED",
    });
  });

  it("honours abort signal with bypass", async () => {
    const store = new FakeValkeyStringStore();
    const cache = new ValkeyExactResponseCache({ store });
    const { storageKey, identityDigest } = fixtures();
    const controller = new AbortController();
    controller.abort();

    await expect(
      cache.lookup(
        { workspaceId: WORKSPACE_A, storageKey, identityDigest },
        { signal: controller.signal },
      ),
    ).resolves.toEqual({
      outcome: "bypass",
      reason: "INFRASTRUCTURE_UNAVAILABLE",
    });
  });

  it("enforces max entry size on put", async () => {
    const store = new FakeValkeyStringStore();
    const cache = new ValkeyExactResponseCache({
      store,
      maxEntryBytes: 128,
    });
    const { storageKey, identityDigest } = fixtures();

    await expect(
      cache.putIfAbsent({
        workspaceId: WORKSPACE_A,
        storageKey,
        identityDigest,
        ttlSeconds: 300,
        entry: {
          identityDigest,
          cachedAt: new Date().toISOString(),
          body: { text: "x".repeat(512) },
        },
      }),
    ).resolves.toEqual({ outcome: "bypass", reason: "ENTRY_TOO_LARGE" });
  });

  it("bypasses on decrypt failure without returning stale plaintext", async () => {
    const store = new FakeValkeyStringStore();
    const writeRing = parseKeyRingFromEnv({
      activeKeyId: "w",
      activeKeyB64: Buffer.alloc(32, 1).toString("base64"),
    });
    const readRing = parseKeyRingFromEnv({
      activeKeyId: "r",
      activeKeyB64: Buffer.alloc(32, 2).toString("base64"),
    });
    const cache = new ValkeyExactResponseCache({
      store,
      wireProtection: createAesGcmWireProtection({
        keyRing: writeRing,
        rejectLegacyPlaintext: true,
      }),
    });
    const { storageKey, identityDigest } = fixtures();
    await cache.putIfAbsent({
      workspaceId: WORKSPACE_A,
      storageKey,
      identityDigest,
      ttlSeconds: 300,
      entry: {
        identityDigest,
        cachedAt: new Date().toISOString(),
        body: { text: "secret-response" },
      },
    });

    const reader = new ValkeyExactResponseCache({
      store,
      wireProtection: createAesGcmWireProtection({
        keyRing: readRing,
        rejectLegacyPlaintext: true,
      }),
    });
    await expect(
      reader.lookup({ workspaceId: WORKSPACE_A, storageKey, identityDigest }),
    ).resolves.toEqual({
      outcome: "bypass",
      reason: "ENCRYPTION_FAILURE",
    });
  });

  it("isolates namespaces between workspaces on write", async () => {
    const store = new FakeValkeyStringStore();
    const cache = new ValkeyExactResponseCache({ store });
    const a = fixtures(WORKSPACE_A);
    const b = fixtures(WORKSPACE_B);

    await cache.putIfAbsent({
      workspaceId: WORKSPACE_A,
      storageKey: a.storageKey,
      identityDigest: a.identityDigest,
      ttlSeconds: 300,
      entry: {
        identityDigest: a.identityDigest,
        cachedAt: new Date().toISOString(),
        body: { text: "A" },
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
});
