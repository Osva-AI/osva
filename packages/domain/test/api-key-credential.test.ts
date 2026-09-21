import type { ApiKeyId } from "@osva/contracts";
import { describe, expect, it } from "vitest";

import {
  API_KEY_SECRET_DIGEST_BYTE_LENGTH,
  API_KEY_TOKEN_PREFIX,
  digestApiKeySecret,
  generateApiKeySecretMaterial,
  parseApiKeyToken,
  verifyApiKeySecret,
} from "../src/api-key-credential.js";

describe("api key credential material", () => {
  it("generates high-entropy tokens with distinct digests", () => {
    const apiKeyId = "key-1" as ApiKeyId;
    const first = generateApiKeySecretMaterial(apiKeyId);
    const second = generateApiKeySecretMaterial(apiKeyId);

    expect(first.plaintextToken.startsWith(API_KEY_TOKEN_PREFIX)).toBe(true);
    expect(first.plaintextToken).not.toBe(second.plaintextToken);
    expect(first.secretDigest.equals(second.secretDigest)).toBe(false);
    expect(first.secretDigest.length).toBe(API_KEY_SECRET_DIGEST_BYTE_LENGTH);
    expect(first.plaintextToken).not.toContain(
      first.secretDigest.toString("hex"),
    );
  });

  it("parses generated tokens and verifies digests with constant-time semantics", () => {
    const apiKeyId = "key-parse" as ApiKeyId;
    const material = generateApiKeySecretMaterial(apiKeyId);
    const parsed = parseApiKeyToken(material.plaintextToken);

    expect(parsed).toEqual({
      apiKeyId,
      secret: material.plaintextToken.slice(
        `${API_KEY_TOKEN_PREFIX}${apiKeyId}.`.length,
      ),
    });
    expect(verifyApiKeySecret(parsed!.secret, material.secretDigest)).toBe(
      true,
    );
    expect(
      verifyApiKeySecret(`${parsed!.secret}x`, material.secretDigest),
    ).toBe(false);
    expect(digestApiKeySecret(parsed!.secret).length).toBe(
      API_KEY_SECRET_DIGEST_BYTE_LENGTH,
    );
  });

  it("rejects malformed and unknown token shapes safely", () => {
    expect(parseApiKeyToken("")).toBeNull();
    expect(parseApiKeyToken("Bearer osva_ak_x")).toBeNull();
    expect(parseApiKeyToken("osva_ak_only-prefix")).toBeNull();
    expect(parseApiKeyToken("osva_ak_id.")).toBeNull();
    expect(parseApiKeyToken("osva_ak_.secret")).toBeNull();
  });
});
