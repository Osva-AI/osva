import type {
  InferenceCacheIdentityDigest,
  InferenceCacheStorageKey,
  ModelProfileVersionId,
  WorkspaceId,
} from "@osva-ai/contracts";
import {
  INFERENCE_CACHE_IDENTITY_DIGEST_PREFIX,
  INFERENCE_CACHE_STORAGE_KEY_PREFIX,
} from "@osva-ai/contracts";

export function testIdentity(input: {
  readonly workspaceId: WorkspaceId;
  readonly hex: string;
}): {
  readonly storageKey: InferenceCacheStorageKey;
  readonly identityDigest: InferenceCacheIdentityDigest;
} {
  const identityDigest =
    `${INFERENCE_CACHE_IDENTITY_DIGEST_PREFIX}${input.hex}` as InferenceCacheIdentityDigest;
  const storageKey =
    `${INFERENCE_CACHE_STORAGE_KEY_PREFIX}${input.workspaceId}:${input.hex}` as InferenceCacheStorageKey;
  return { storageKey, identityDigest };
}

export const TEST_PROFILE = "mpv_testaaaaaaaaaaaa" as ModelProfileVersionId;
