import { createHash } from "node:crypto";

import {
  INFERENCE_CACHE_IDENTITY_DIGEST_PREFIX,
  INFERENCE_CACHE_IDENTITY_FORMAT_VERSION,
  INFERENCE_CACHE_LEGACY_CONNECTION_SENTINEL,
  INFERENCE_CACHE_STORAGE_KEY_PREFIX,
  type InferenceCacheIdentityDigest,
  type InferenceCacheRequestMaterial,
  type InferenceCacheStorageKey,
  type WorkspaceId,
} from "@osva-ai/contracts";
import type { JsonValue } from "@osva-ai/contracts";

import { canonicalJsonStringify } from "../json-equality.js";

const DOMAIN_SEPARATOR = "osva:inference-exact-response" as const;

export interface InferenceCacheIdentityResult {
  readonly identityDigest: InferenceCacheIdentityDigest;
  readonly storageKey: InferenceCacheStorageKey;
}

/**
 * Builds a versioned cache identity and workspace-namespaced storage key.
 * Prompt content never appears in keys — only digests.
 */
export function buildInferenceCacheIdentity(input: {
  readonly workspaceId: WorkspaceId;
  readonly material: InferenceCacheRequestMaterial;
}): InferenceCacheIdentityResult | undefined {
  const payload = buildIdentityPayload(input.workspaceId, input.material);
  if (payload === undefined) {
    return undefined;
  }

  const canonical = canonicalJsonStringify(payload as JsonValue);
  const hex = createHash("sha256")
    .update(DOMAIN_SEPARATOR, "utf8")
    .update("\0", "utf8")
    .update(`v${INFERENCE_CACHE_IDENTITY_FORMAT_VERSION}`, "utf8")
    .update("\0", "utf8")
    .update(canonical, "utf8")
    .digest("hex")
    .toLowerCase();

  const identityDigest =
    `${INFERENCE_CACHE_IDENTITY_DIGEST_PREFIX}${hex}` as InferenceCacheIdentityDigest;

  const storageKey =
    `${INFERENCE_CACHE_STORAGE_KEY_PREFIX}${input.workspaceId}:${hex}` as InferenceCacheStorageKey;

  return { identityDigest, storageKey };
}

function buildIdentityPayload(
  workspaceId: WorkspaceId,
  material: InferenceCacheRequestMaterial,
): Record<string, unknown> | undefined {
  if (
    workspaceId.trim().length === 0 ||
    material.modelProfileVersionId.trim().length === 0 ||
    material.configuredModelId.trim().length === 0
  ) {
    return undefined;
  }

  if (!Array.isArray(material.messages) || material.messages.length === 0) {
    return undefined;
  }

  const connectionVersionId =
    material.modelProviderConnectionVersionId ??
    INFERENCE_CACHE_LEGACY_CONNECTION_SENTINEL;

  return {
    identityFormatVersion: INFERENCE_CACHE_IDENTITY_FORMAT_VERSION,
    workspaceId,
    modelProfileVersionId: material.modelProfileVersionId,
    modelProviderConnectionVersionId: connectionVersionId,
    provider: material.provider,
    configuredModelId: material.configuredModelId,
    messages: material.messages,
    maxOutputTokens: material.maxOutputTokens ?? null,
    toolDefinitions: material.toolDefinitions ?? null,
    jsonSchema: material.jsonSchema ?? null,
    cachePolicyVersionId: material.cachePolicyVersionId ?? null,
    routingPolicyVersionId: material.routingPolicyVersionId ?? null,
  };
}

export function isInferenceCacheIdentityDigest(
  value: string,
): value is InferenceCacheIdentityDigest {
  if (!value.startsWith(INFERENCE_CACHE_IDENTITY_DIGEST_PREFIX)) {
    return false;
  }
  const hex = value.slice(INFERENCE_CACHE_IDENTITY_DIGEST_PREFIX.length);
  return /^[0-9a-f]{64}$/.test(hex);
}
