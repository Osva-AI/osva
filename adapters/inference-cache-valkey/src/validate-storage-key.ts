import {
  INFERENCE_CACHE_IDENTITY_DIGEST_PREFIX,
  INFERENCE_CACHE_STORAGE_KEY_PREFIX,
  type InferenceCacheIdentityDigest,
  type InferenceCacheStorageKey,
  type WorkspaceId,
} from "@osva-ai/contracts";

const STORAGE_KEY_PATTERN = new RegExp(
  `^${escapeRegex(INFERENCE_CACHE_STORAGE_KEY_PREFIX)}([^:]+):([0-9a-f]{64})$`,
);

export type StorageKeyBindingResult =
  | {
      readonly valid: true;
      readonly workspaceId: WorkspaceId;
      readonly identityHex: string;
    }
  | { readonly valid: false };

export function parseStorageKeyBinding(
  storageKey: InferenceCacheStorageKey,
): StorageKeyBindingResult {
  const match = STORAGE_KEY_PATTERN.exec(storageKey);
  if (match === null) {
    return { valid: false };
  }

  const workspaceId = match[1] as WorkspaceId;
  const identityHex = match[2];
  if (workspaceId.length === 0 || identityHex === undefined) {
    return { valid: false };
  }

  return { valid: true, workspaceId, identityHex };
}

export function identityDigestHex(
  identityDigest: InferenceCacheIdentityDigest,
): string | undefined {
  if (!identityDigest.startsWith(INFERENCE_CACHE_IDENTITY_DIGEST_PREFIX)) {
    return undefined;
  }
  const hex = identityDigest.slice(
    INFERENCE_CACHE_IDENTITY_DIGEST_PREFIX.length,
  );
  if (!/^[0-9a-f]{64}$/.test(hex)) {
    return undefined;
  }
  return hex;
}

export function validateAuthorizedStorageBinding(input: {
  readonly authorizedWorkspaceId: WorkspaceId;
  readonly storageKey: InferenceCacheStorageKey;
  readonly identityDigest: InferenceCacheIdentityDigest;
}): boolean {
  const parsed = parseStorageKeyBinding(input.storageKey);
  if (!parsed.valid) {
    return false;
  }

  if (parsed.workspaceId !== input.authorizedWorkspaceId) {
    return false;
  }

  const digestHex = identityDigestHex(input.identityDigest);
  if (digestHex === undefined) {
    return false;
  }

  return parsed.identityHex === digestHex;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
