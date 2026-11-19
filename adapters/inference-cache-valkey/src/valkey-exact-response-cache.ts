import {
  INFERENCE_CACHE_MAX_TTL_SECONDS,
  INFERENCE_CACHE_MIN_TTL_SECONDS,
  type ExactResponseCacheLookupRequest,
  type ExactResponseCacheLookupResult,
  type ExactResponseCachePort,
  type ExactResponseCachePutRequest,
  type ExactResponseCachePutResult,
  type InferenceCacheCancellationSignal,
} from "@osva-ai/contracts";

import {
  decodeEnvelope,
  DEFAULT_ENVELOPE_MAX_BYTES,
  encodeEnvelope,
} from "./envelope.js";
import { validateAuthorizedStorageBinding } from "./validate-storage-key.js";
import {
  type ValkeyStringCommands,
  IoValkeyStringStore,
  isInfrastructureError,
  type ValkeyStringStoreOptions,
} from "./valkey-string-store.js";
import {
  decryptCiphertext,
  encryptPlaintext,
  isEncryptedCacheWire,
  type InferenceCacheKeyRing,
} from "./crypto/aes-gcm.js";

export type CacheWireProtectionRevealResult =
  | { readonly ok: true; readonly plaintextWire: string }
  | {
      readonly ok: false;
      readonly reason: "ENCRYPTION_FAILURE" | "LEGACY_PLAINTEXT_DISALLOWED";
    };

export interface CacheWireProtection {
  protectPlaintext(input: {
    readonly workspaceId: ExactResponseCacheLookupRequest["workspaceId"];
    readonly identityDigest: ExactResponseCacheLookupRequest["identityDigest"];
    readonly storageKey: ExactResponseCacheLookupRequest["storageKey"];
    readonly plaintextWire: string;
  }): string;
  revealPlaintext(input: {
    readonly workspaceId: ExactResponseCacheLookupRequest["workspaceId"];
    readonly identityDigest: ExactResponseCacheLookupRequest["identityDigest"];
    readonly storageKey: ExactResponseCacheLookupRequest["storageKey"];
    readonly storedWire: string;
  }): CacheWireProtectionRevealResult;
}

export interface ValkeyExactResponseCacheOptions extends ValkeyStringStoreOptions {
  readonly store?: ValkeyStringCommands;
  readonly clock?: () => Date;
  readonly maxEntryBytes?: number;
  readonly wireProtection?: CacheWireProtection;
  readonly onCacheEvent?: (event: {
    readonly kind:
      | "lookup_attempt"
      | "hit"
      | "miss"
      | "bypass"
      | "put_attempt"
      | "put_created";
    readonly reason?: string;
  }) => void;
}

export class ValkeyExactResponseCache implements ExactResponseCachePort {
  private readonly store: ValkeyStringCommands;
  private readonly ownsStore: boolean;
  private readonly clock: () => Date;
  private readonly maxEntryBytes: number;
  private readonly wireProtection: CacheWireProtection | undefined;
  private readonly onCacheEvent: ValkeyExactResponseCacheOptions["onCacheEvent"];

  constructor(options: ValkeyExactResponseCacheOptions) {
    if (options.store !== undefined) {
      this.store = options.store;
      this.ownsStore = false;
    } else {
      this.store = new IoValkeyStringStore(options);
      this.ownsStore = true;
    }
    this.clock = options.clock ?? (() => new Date());
    this.maxEntryBytes = options.maxEntryBytes ?? DEFAULT_ENVELOPE_MAX_BYTES;
    this.wireProtection = options.wireProtection;
    this.onCacheEvent = options.onCacheEvent;
  }

  async lookup(
    request: ExactResponseCacheLookupRequest,
    options?: { readonly signal?: InferenceCacheCancellationSignal },
  ): Promise<ExactResponseCacheLookupResult> {
    if (options?.signal?.aborted === true) {
      return { outcome: "bypass", reason: "INFRASTRUCTURE_UNAVAILABLE" };
    }

    if (
      !validateAuthorizedStorageBinding({
        authorizedWorkspaceId: request.workspaceId,
        storageKey: request.storageKey,
        identityDigest: request.identityDigest,
      })
    ) {
      return { outcome: "bypass", reason: "UNAUTHORIZED" };
    }

    this.onCacheEvent?.({ kind: "lookup_attempt" });

    try {
      const storedWire = await this.store.get(request.storageKey);
      if (storedWire === null) {
        this.onCacheEvent?.({ kind: "miss" });
        return { outcome: "miss" };
      }

      const wire = this.revealWire(request, storedWire);
      if (wire === undefined) {
        this.onCacheEvent?.({ kind: "bypass", reason: "ENCRYPTION_FAILURE" });
        return { outcome: "bypass", reason: "ENCRYPTION_FAILURE" };
      }

      const decoded = decodeEnvelope({
        wire,
        now: this.clock(),
        authorizedWorkspaceId: request.workspaceId,
        expectedIdentityDigest: request.identityDigest,
        maxBytes: this.maxEntryBytes,
      });

      if (!decoded.ok) {
        if (decoded.reason === "unauthorized") {
          return { outcome: "bypass", reason: "UNAUTHORIZED" };
        }
        if (decoded.reason === "expired") {
          try {
            await this.store.del(request.storageKey);
          } catch {
            // Best-effort expiry cleanup.
          }
          return { outcome: "miss" };
        }
        this.onCacheEvent?.({ kind: "bypass", reason: "corrupt" });
        return {
          outcome: "corrupt",
          identityDigest: request.identityDigest,
        };
      }

      this.onCacheEvent?.({ kind: "hit" });
      return { outcome: "hit", entry: decoded.entry };
    } catch (error) {
      if (isInfrastructureError(error)) {
        return { outcome: "bypass", reason: "INFRASTRUCTURE_UNAVAILABLE" };
      }
      return {
        outcome: "corrupt",
        identityDigest: request.identityDigest,
      };
    }
  }

  async putIfAbsent(
    request: ExactResponseCachePutRequest,
    options?: { readonly signal?: InferenceCacheCancellationSignal },
  ): Promise<ExactResponseCachePutResult> {
    if (options?.signal?.aborted === true) {
      return { outcome: "bypass", reason: "INFRASTRUCTURE_UNAVAILABLE" };
    }

    if (
      !validateAuthorizedStorageBinding({
        authorizedWorkspaceId: request.workspaceId,
        storageKey: request.storageKey,
        identityDigest: request.identityDigest,
      })
    ) {
      return { outcome: "bypass", reason: "UNAUTHORIZED" };
    }

    if (request.entry.identityDigest !== request.identityDigest) {
      return { outcome: "rejected", reason: "IDENTITY_INCOMPLETE" };
    }

    const ttl = normalizeTtlSeconds(request.ttlSeconds);
    if (ttl === undefined) {
      return { outcome: "rejected", reason: "REQUEST_INVALID" };
    }

    this.onCacheEvent?.({ kind: "put_attempt" });

    const encoded = encodeEnvelope({
      workspaceId: request.workspaceId,
      identityDigest: request.identityDigest,
      cachedAt: this.clock(),
      ttlSeconds: ttl,
      body: request.entry.body,
      maxBytes: this.maxEntryBytes,
    });

    if (!encoded.ok) {
      return { outcome: "bypass", reason: "ENTRY_TOO_LARGE" };
    }

    let storedWire = encoded.wire;
    if (this.wireProtection !== undefined) {
      try {
        storedWire = this.wireProtection.protectPlaintext({
          workspaceId: request.workspaceId,
          identityDigest: request.identityDigest,
          storageKey: request.storageKey,
          plaintextWire: encoded.wire,
        });
      } catch {
        return { outcome: "bypass", reason: "ENCRYPTION_FAILURE" };
      }
    }

    try {
      const created = await this.store.setNxEx(
        request.storageKey,
        storedWire,
        ttl,
      );
      if (created === "OK") {
        this.onCacheEvent?.({ kind: "put_created" });
      }
      return created === "OK" ? { outcome: "created" } : { outcome: "exists" };
    } catch (error) {
      if (isInfrastructureError(error)) {
        return { outcome: "bypass", reason: "INFRASTRUCTURE_UNAVAILABLE" };
      }
      return { outcome: "rejected", reason: "REQUEST_INVALID" };
    }
  }

  private revealWire(
    request: ExactResponseCacheLookupRequest,
    storedWire: string,
  ): string | undefined {
    if (this.wireProtection === undefined) {
      return storedWire;
    }

    const revealed = this.wireProtection.revealPlaintext({
      workspaceId: request.workspaceId,
      identityDigest: request.identityDigest,
      storageKey: request.storageKey,
      storedWire,
    });
    if (!revealed.ok) {
      return undefined;
    }
    return revealed.plaintextWire;
  }

  async close(): Promise<void> {
    if (this.ownsStore && this.store instanceof IoValkeyStringStore) {
      await this.store.close();
    }
  }
}

export function createAesGcmWireProtection(input: {
  readonly keyRing: InferenceCacheKeyRing;
  readonly rejectLegacyPlaintext: boolean;
}): CacheWireProtection {
  return {
    protectPlaintext(payload) {
      return encryptPlaintext({
        keyRing: input.keyRing,
        workspaceId: payload.workspaceId,
        identityDigest: payload.identityDigest,
        storageKey: payload.storageKey,
        plaintextUtf8: payload.plaintextWire,
      });
    },
    revealPlaintext(payload) {
      if (!isEncryptedCacheWire(payload.storedWire)) {
        if (input.rejectLegacyPlaintext) {
          return { ok: false, reason: "LEGACY_PLAINTEXT_DISALLOWED" };
        }
        return { ok: true, plaintextWire: payload.storedWire };
      }

      const decrypted = decryptCiphertext({
        keyRing: input.keyRing,
        workspaceId: payload.workspaceId,
        identityDigest: payload.identityDigest,
        storageKey: payload.storageKey,
        wire: payload.storedWire,
      });
      if (!decrypted.ok) {
        return { ok: false, reason: "ENCRYPTION_FAILURE" };
      }
      return { ok: true, plaintextWire: decrypted.plaintextUtf8 };
    },
  };
}

export function normalizeTtlSeconds(ttlSeconds: number): number | undefined {
  if (
    !Number.isFinite(ttlSeconds) ||
    ttlSeconds < INFERENCE_CACHE_MIN_TTL_SECONDS ||
    ttlSeconds > INFERENCE_CACHE_MAX_TTL_SECONDS
  ) {
    return undefined;
  }
  return Math.floor(ttlSeconds);
}
