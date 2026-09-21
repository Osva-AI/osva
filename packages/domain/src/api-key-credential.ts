import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

import type { ApiKeyId } from "@osva/contracts";

export const API_KEY_TOKEN_PREFIX = "osva_ak_";

export const API_KEY_SECRET_DIGEST_BYTE_LENGTH = 32;

const SECRET_BYTE_LENGTH = 32;

const TOKEN_PATTERN = /^osva_ak_([0-9A-Za-z_-]+)\.([0-9A-Za-z_-]+)$/;

export interface ParsedApiKeyToken {
  readonly apiKeyId: ApiKeyId;
  readonly secret: string;
}

export interface GeneratedApiKeySecretMaterial {
  readonly plaintextToken: string;
  readonly secretDigest: Buffer;
}

export function generateApiKeySecretMaterial(
  apiKeyId: ApiKeyId,
): GeneratedApiKeySecretMaterial {
  const secret = randomBytes(SECRET_BYTE_LENGTH).toString("base64url");
  const secretDigest = digestApiKeySecret(secret);
  const plaintextToken = `${API_KEY_TOKEN_PREFIX}${apiKeyId}.${secret}`;

  return {
    plaintextToken,
    secretDigest,
  };
}

export function parseApiKeyToken(token: string): ParsedApiKeyToken | null {
  const trimmed = token.trim();
  if (trimmed.length === 0) {
    return null;
  }

  const match = TOKEN_PATTERN.exec(trimmed);
  if (match === null) {
    return null;
  }

  const apiKeyId = match[1] as ApiKeyId;
  const secret = match[2]!;
  if (apiKeyId.length === 0 || secret.length === 0) {
    return null;
  }

  return { apiKeyId, secret };
}

export function digestApiKeySecret(secret: string): Buffer {
  return createHash("sha256").update(secret, "utf8").digest();
}

export function verifyApiKeySecret(
  secret: string,
  storedDigest: Buffer,
): boolean {
  if (storedDigest.length !== API_KEY_SECRET_DIGEST_BYTE_LENGTH) {
    return false;
  }

  const candidateDigest = digestApiKeySecret(secret);
  return timingSafeEqual(candidateDigest, storedDigest);
}
