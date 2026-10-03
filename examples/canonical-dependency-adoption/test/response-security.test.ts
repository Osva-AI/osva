import { describe, expect, it } from "vitest";

import {
  safeDemoErrorMessage,
  serializedResponseContainsSecretMaterial,
} from "../demo/response-security.js";

describe("serializedResponseContainsSecretMaterial", () => {
  it("does not flag legitimate run step token usage fields", () => {
    const serialized = JSON.stringify({
      steps: [
        {
          bindingName: "policy_docs",
          inputTokens: 1200,
          outputTokens: 340,
          totalTokens: 1540,
        },
      ],
    });
    expect(serializedResponseContainsSecretMaterial(serialized)).toBe(false);
  });

  it("flags embedded operator API keys", () => {
    const apiKey = "super-secret-test-key";
    const serialized = JSON.stringify({ note: `failed with ${apiKey}` });
    expect(
      serializedResponseContainsSecretMaterial(serialized, {
        forbiddenLiteralSubstrings: [apiKey],
      }),
    ).toBe(true);
  });

  it("flags forbidden JSON key names", () => {
    const serialized = JSON.stringify({ apiKey: "leaked" });
    expect(serializedResponseContainsSecretMaterial(serialized)).toBe(true);
  });

  it("flags postgres and valkey connection strings", () => {
    expect(
      serializedResponseContainsSecretMaterial(
        '{"url":"postgres://user:pass@127.0.0.1:5432/osva"}',
      ),
    ).toBe(true);
    expect(
      serializedResponseContainsSecretMaterial(
        '{"url":"valkey://127.0.0.1:6379"}',
      ),
    ).toBe(true);
  });

  it("ignores empty forbidden literal entries", () => {
    const serialized = JSON.stringify({ packageName: "zod" });
    expect(
      serializedResponseContainsSecretMaterial(serialized, {
        forbiddenLiteralSubstrings: ["", "   "],
      }),
    ).toBe(false);
  });
});

describe("safeDemoErrorMessage", () => {
  it("redacts error messages that contain forbidden literals", () => {
    const apiKey = "super-secret-test-key";
    expect(
      safeDemoErrorMessage(`Upstream rejected ${apiKey}`, {
        forbiddenLiteralSubstrings: [apiKey],
      }),
    ).toBe("Demo server error.");
  });
});
