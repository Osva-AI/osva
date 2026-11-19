import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

import {
  INFERENCE_CACHE_ENCRYPTED_WIRE_FORMAT_VERSION,
  type InferenceCacheIdentityDigest,
  type WorkspaceId,
} from "@osva-ai/contracts";

const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;

export interface InferenceCacheKeyRing {
  /** Active key for encryption. */
  readonly activeKeyId: string;
  readonly keys: Readonly<Record<string, Buffer>>;
}

export interface EncryptedWirePayloadV1 {
  readonly wireFormatVersion: typeof INFERENCE_CACHE_ENCRYPTED_WIRE_FORMAT_VERSION;
  readonly keyId: string;
  readonly nonceB64: string;
  readonly ciphertextB64: string;
  readonly tagB64: string;
}

export function parseKeyRingFromEnv(input: {
  readonly activeKeyId: string;
  readonly activeKeyB64: string;
  readonly readKeysB64?: Readonly<Record<string, string>>;
}): InferenceCacheKeyRing {
  const keys: Record<string, Buffer> = {};
  keys[input.activeKeyId] = decodeKey(input.activeKeyB64);
  if (input.readKeysB64 !== undefined) {
    for (const [id, material] of Object.entries(input.readKeysB64)) {
      keys[id] = decodeKey(material);
    }
  }
  return { activeKeyId: input.activeKeyId, keys: Object.freeze(keys) };
}

export function encryptPlaintext(input: {
  readonly keyRing: InferenceCacheKeyRing;
  readonly workspaceId: WorkspaceId;
  readonly identityDigest: InferenceCacheIdentityDigest;
  readonly storageKey: string;
  readonly plaintextUtf8: string;
}): string {
  const key = input.keyRing.keys[input.keyRing.activeKeyId];
  if (key === undefined) {
    throw new Error("Active encryption key is not configured.");
  }

  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  cipher.setAAD(
    buildAad(input.workspaceId, input.identityDigest, input.storageKey),
  );
  const ciphertext = Buffer.concat([
    cipher.update(input.plaintextUtf8, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  const payload: EncryptedWirePayloadV1 = {
    wireFormatVersion: INFERENCE_CACHE_ENCRYPTED_WIRE_FORMAT_VERSION,
    keyId: input.keyRing.activeKeyId,
    nonceB64: nonce.toString("base64"),
    ciphertextB64: ciphertext.toString("base64"),
    tagB64: tag.toString("base64"),
  };
  return JSON.stringify(payload);
}

export type DecryptPlaintextResult =
  | { readonly ok: true; readonly plaintextUtf8: string }
  | {
      readonly ok: false;
      readonly reason:
        "UNSUPPORTED_VERSION" | "INVALID_WIRE" | "UNKNOWN_KEY" | "AUTH_FAILED";
    };

export function decryptCiphertext(input: {
  readonly keyRing: InferenceCacheKeyRing;
  readonly workspaceId: WorkspaceId;
  readonly identityDigest: InferenceCacheIdentityDigest;
  readonly storageKey: string;
  readonly wire: string;
}): DecryptPlaintextResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(input.wire);
  } catch {
    return { ok: false, reason: "INVALID_WIRE" };
  }

  if (!isEncryptedWireV1(parsed)) {
    return { ok: false, reason: "INVALID_WIRE" };
  }

  if (
    parsed.wireFormatVersion !== INFERENCE_CACHE_ENCRYPTED_WIRE_FORMAT_VERSION
  ) {
    return { ok: false, reason: "UNSUPPORTED_VERSION" };
  }

  const key = input.keyRing.keys[parsed.keyId];
  if (key === undefined) {
    return { ok: false, reason: "UNKNOWN_KEY" };
  }

  try {
    const nonce = Buffer.from(parsed.nonceB64, "base64");
    const ciphertext = Buffer.from(parsed.ciphertextB64, "base64");
    const tag = Buffer.from(parsed.tagB64, "base64");
    if (nonce.length !== NONCE_BYTES || tag.length !== TAG_BYTES) {
      return { ok: false, reason: "INVALID_WIRE" };
    }

    const decipher = createDecipheriv("aes-256-gcm", key, nonce);
    decipher.setAAD(
      buildAad(input.workspaceId, input.identityDigest, input.storageKey),
    );
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]);
    return { ok: true, plaintextUtf8: plaintext.toString("utf8") };
  } catch {
    return { ok: false, reason: "AUTH_FAILED" };
  }
}

function buildAad(
  workspaceId: WorkspaceId,
  identityDigest: InferenceCacheIdentityDigest,
  storageKey: string,
): Buffer {
  return Buffer.from(
    `${workspaceId}\n${identityDigest}\n${storageKey}`,
    "utf8",
  );
}

function decodeKey(base64: string): Buffer {
  const key = Buffer.from(base64, "base64");
  if (key.length !== KEY_BYTES) {
    throw new Error(
      "Inference cache encryption key must be 32 bytes (base64).",
    );
  }
  return key;
}

export function isEncryptedCacheWire(wire: string): boolean {
  try {
    const parsed = JSON.parse(wire) as unknown;
    return isEncryptedWireV1(parsed);
  } catch {
    return false;
  }
}

function isEncryptedWireV1(value: unknown): value is EncryptedWirePayloadV1 {
  if (value === null || typeof value !== "object") {
    return false;
  }
  const candidate = value as EncryptedWirePayloadV1;
  return (
    candidate.wireFormatVersion ===
      INFERENCE_CACHE_ENCRYPTED_WIRE_FORMAT_VERSION &&
    typeof candidate.keyId === "string" &&
    typeof candidate.nonceB64 === "string" &&
    typeof candidate.ciphertextB64 === "string" &&
    typeof candidate.tagB64 === "string"
  );
}
