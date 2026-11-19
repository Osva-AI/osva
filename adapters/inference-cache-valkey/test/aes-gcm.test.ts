import { describe, expect, it } from "vitest";

import type { WorkspaceId } from "@osva-ai/contracts";
import {
  INFERENCE_CACHE_ENCRYPTED_WIRE_FORMAT_VERSION,
  INFERENCE_CACHE_IDENTITY_DIGEST_PREFIX,
  INFERENCE_CACHE_STORAGE_KEY_PREFIX,
} from "@osva-ai/contracts";

import {
  decryptCiphertext,
  encryptPlaintext,
  isEncryptedCacheWire,
  parseKeyRingFromEnv,
} from "../src/crypto/aes-gcm.js";

const WORKSPACE = "ws_encrypt_test_12345" as WorkspaceId;
const DIGEST =
  `${INFERENCE_CACHE_IDENTITY_DIGEST_PREFIX}${"a".repeat(64)}` as const;
const STORAGE_KEY = `${INFERENCE_CACHE_STORAGE_KEY_PREFIX}${WORKSPACE}:${"b".repeat(64)}`;

const KEY_RING = parseKeyRingFromEnv({
  activeKeyId: "v1",
  activeKeyB64: Buffer.alloc(32, 9).toString("base64"),
  readKeysB64: {
    v0: Buffer.alloc(32, 3).toString("base64"),
  },
});

describe("inference cache AES-GCM wire protection", () => {
  it("round-trips plaintext", () => {
    const plaintext = '{"schemaVersion":"1"}';
    const wire = encryptPlaintext({
      keyRing: KEY_RING,
      workspaceId: WORKSPACE,
      identityDigest: DIGEST,
      storageKey: STORAGE_KEY,
      plaintextUtf8: plaintext,
    });
    expect(isEncryptedCacheWire(wire)).toBe(true);
    const parsed = JSON.parse(wire) as { wireFormatVersion: string };
    expect(parsed.wireFormatVersion).toBe(
      INFERENCE_CACHE_ENCRYPTED_WIRE_FORMAT_VERSION,
    );

    const decrypted = decryptCiphertext({
      keyRing: KEY_RING,
      workspaceId: WORKSPACE,
      identityDigest: DIGEST,
      storageKey: STORAGE_KEY,
      wire,
    });
    expect(decrypted).toEqual({ ok: true, plaintextUtf8: plaintext });
  });

  it("rejects tampered ciphertext", () => {
    const wire = encryptPlaintext({
      keyRing: KEY_RING,
      workspaceId: WORKSPACE,
      identityDigest: DIGEST,
      storageKey: STORAGE_KEY,
      plaintextUtf8: "hello",
    });
    const parsed = JSON.parse(wire) as { ciphertextB64: string };
    const tampered = JSON.stringify({
      ...JSON.parse(wire),
      ciphertextB64: `${parsed.ciphertextB64.slice(0, -2)}aa`,
    });
    const result = decryptCiphertext({
      keyRing: KEY_RING,
      workspaceId: WORKSPACE,
      identityDigest: DIGEST,
      storageKey: STORAGE_KEY,
      wire: tampered,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("AUTH_FAILED");
    }
  });

  it("rejects wrong workspace AAD binding", () => {
    const wire = encryptPlaintext({
      keyRing: KEY_RING,
      workspaceId: WORKSPACE,
      identityDigest: DIGEST,
      storageKey: STORAGE_KEY,
      plaintextUtf8: "hello",
    });
    const result = decryptCiphertext({
      keyRing: KEY_RING,
      workspaceId: "ws_other_workspace" as WorkspaceId,
      identityDigest: DIGEST,
      storageKey: STORAGE_KEY,
      wire,
    });
    expect(result.ok).toBe(false);
  });

  it("decrypts with a retired read key", () => {
    const oldRing = parseKeyRingFromEnv({
      activeKeyId: "v0",
      activeKeyB64: Buffer.alloc(32, 3).toString("base64"),
    });
    const wire = encryptPlaintext({
      keyRing: oldRing,
      workspaceId: WORKSPACE,
      identityDigest: DIGEST,
      storageKey: STORAGE_KEY,
      plaintextUtf8: "legacy",
    });
    const result = decryptCiphertext({
      keyRing: KEY_RING,
      workspaceId: WORKSPACE,
      identityDigest: DIGEST,
      storageKey: STORAGE_KEY,
      wire,
    });
    expect(result).toEqual({ ok: true, plaintextUtf8: "legacy" });
  });
});
