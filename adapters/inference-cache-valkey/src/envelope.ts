import {
  INFERENCE_CACHE_DEFAULT_MAX_ENTRY_BYTES,
  INFERENCE_CACHE_ENTRY_FORMAT_VERSION,
  type ExactResponseCacheEntry,
  type InferenceCacheStorableResponse,
  type WorkspaceId,
} from "@osva-ai/contracts";
import type { InferenceCacheIdentityDigest } from "@osva-ai/contracts";

export interface ExactResponseCacheEnvelopeV1 {
  readonly schemaVersion: typeof INFERENCE_CACHE_ENTRY_FORMAT_VERSION;
  readonly workspaceId: WorkspaceId;
  readonly identityDigest: InferenceCacheIdentityDigest;
  readonly cachedAt: string;
  readonly expiresAt: string;
  readonly body: InferenceCacheStorableResponse;
}

export type EncodeEnvelopeResult =
  | { readonly ok: true; readonly wire: string; readonly bytes: number }
  | { readonly ok: false; readonly reason: "ENTRY_TOO_LARGE" };

export function encodeEnvelope(input: {
  readonly workspaceId: WorkspaceId;
  readonly identityDigest: InferenceCacheIdentityDigest;
  readonly cachedAt: Date;
  readonly ttlSeconds: number;
  readonly body: InferenceCacheStorableResponse;
  readonly maxBytes: number;
}): EncodeEnvelopeResult {
  const expiresAt = new Date(
    input.cachedAt.getTime() + input.ttlSeconds * 1_000,
  );
  const envelope: ExactResponseCacheEnvelopeV1 = {
    schemaVersion: INFERENCE_CACHE_ENTRY_FORMAT_VERSION,
    workspaceId: input.workspaceId,
    identityDigest: input.identityDigest,
    cachedAt: input.cachedAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
    body: input.body,
  };

  const wire = JSON.stringify(envelope);
  const bytes = Buffer.byteLength(wire, "utf8");
  if (bytes > input.maxBytes) {
    return { ok: false, reason: "ENTRY_TOO_LARGE" };
  }

  return { ok: true, wire, bytes };
}

export type DecodeEnvelopeResult =
  | { readonly ok: true; readonly entry: ExactResponseCacheEntry }
  | {
      readonly ok: false;
      readonly reason: "corrupt" | "expired" | "unauthorized";
    };

export function decodeEnvelope(input: {
  readonly wire: string;
  readonly now: Date;
  readonly authorizedWorkspaceId: WorkspaceId;
  readonly expectedIdentityDigest: InferenceCacheIdentityDigest;
  readonly maxBytes: number;
}): DecodeEnvelopeResult {
  if (Buffer.byteLength(input.wire, "utf8") > input.maxBytes) {
    return { ok: false, reason: "corrupt" };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(input.wire);
  } catch {
    return { ok: false, reason: "corrupt" };
  }

  if (!isEnvelopeV1(parsed)) {
    return { ok: false, reason: "corrupt" };
  }

  if (parsed.workspaceId !== input.authorizedWorkspaceId) {
    return { ok: false, reason: "unauthorized" };
  }

  if (parsed.identityDigest !== input.expectedIdentityDigest) {
    return { ok: false, reason: "unauthorized" };
  }

  const expiresAt = Date.parse(parsed.expiresAt);
  if (Number.isNaN(expiresAt) || expiresAt <= input.now.getTime()) {
    return { ok: false, reason: "expired" };
  }

  return {
    ok: true,
    entry: {
      identityDigest: parsed.identityDigest,
      cachedAt: parsed.cachedAt,
      body: parsed.body,
    },
  };
}

function isEnvelopeV1(value: unknown): value is ExactResponseCacheEnvelopeV1 {
  if (value === null || typeof value !== "object") {
    return false;
  }
  const candidate = value as ExactResponseCacheEnvelopeV1;
  if (candidate.schemaVersion !== INFERENCE_CACHE_ENTRY_FORMAT_VERSION) {
    return false;
  }
  if (typeof candidate.workspaceId !== "string") {
    return false;
  }
  if (typeof candidate.identityDigest !== "string") {
    return false;
  }
  if (typeof candidate.cachedAt !== "string") {
    return false;
  }
  if (typeof candidate.expiresAt !== "string") {
    return false;
  }
  if (candidate.body === null || typeof candidate.body !== "object") {
    return false;
  }
  return true;
}

export const DEFAULT_ENVELOPE_MAX_BYTES =
  INFERENCE_CACHE_DEFAULT_MAX_ENTRY_BYTES;
