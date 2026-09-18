import { describe, expect, it } from "vitest";

import {
  issueBootstrapToken,
  issueCapabilityToken,
  verifyBootstrapToken,
  verifyCapabilityToken,
} from "../src/capability-token.js";

const SECRET = "capability-secret";
const NOW = new Date("2026-01-15T12:00:00.000Z");

describe("capability tokens", () => {
  it("issues and verifies an execution-scoped token", () => {
    const token = issueCapabilityToken(SECRET, {
      executionId: "attempt-1",
      workspaceId: "ws-1",
      runId: "run-1",
      exp: NOW.getTime() + 30_000,
    });

    expect(token.includes("attempt-1")).toBe(false);
    expect(verifyCapabilityToken(SECRET, token, NOW)).toMatchObject({
      executionId: "attempt-1",
      workspaceId: "ws-1",
      runId: "run-1",
    });
  });

  it("rejects invalid, expired, and tampered tokens", () => {
    const token = issueCapabilityToken(SECRET, {
      executionId: "attempt-1",
      workspaceId: "ws-1",
      runId: "run-1",
      exp: NOW.getTime() + 30_000,
    });

    expect(verifyCapabilityToken(SECRET, "not-a-token", NOW)).toBeUndefined();
    expect(verifyCapabilityToken("other-secret", token, NOW)).toBeUndefined();
    expect(
      verifyCapabilityToken(
        SECRET,
        issueCapabilityToken(SECRET, {
          executionId: "attempt-1",
          workspaceId: "ws-1",
          runId: "run-1",
          exp: NOW.getTime(),
        }),
        NOW,
      ),
    ).toBeUndefined();
    expect(verifyCapabilityToken(SECRET, `${token}x`, NOW)).toBeUndefined();
  });

  it("separates bootstrap tokens from capability tokens", () => {
    const bootstrap = issueBootstrapToken(SECRET, {
      executionId: "attempt-1",
      exp: NOW.getTime() + 30_000,
    });

    expect(verifyBootstrapToken(SECRET, bootstrap, NOW)).toMatchObject({
      executionId: "attempt-1",
    });
    expect(verifyCapabilityToken(SECRET, bootstrap, NOW)).toBeUndefined();
  });
});
