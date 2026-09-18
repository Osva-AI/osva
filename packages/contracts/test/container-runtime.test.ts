import { describe, expect, it } from "vitest";

import { isDigestPinnedOciImageReference } from "../src/container-runtime.js";

const VALID_DIGEST = `sha256:${"a".repeat(64)}`;

describe("isDigestPinnedOciImageReference", () => {
  it("accepts OSVA canonical repository@sha256:<digest> references", () => {
    expect(
      isDigestPinnedOciImageReference(
        `registry.example.com/agent@${VALID_DIGEST}`,
      ),
    ).toBe(true);
    expect(isDigestPinnedOciImageReference(`agent@${VALID_DIGEST}`)).toBe(true);
    expect(
      isDigestPinnedOciImageReference(`localhost:5000/agent@${VALID_DIGEST}`),
    ).toBe(true);
  });

  it.each([
    "agent:latest",
    "agent:v1",
    "registry.example.com/agent:latest",
    "registry.example.com/agent:1.0.0",
    `agent:tag@${VALID_DIGEST}`,
    "agent",
    "",
    `agent@sha256:${"a".repeat(63)}`,
    `agent@sha256:${"g".repeat(64)}`,
    "agent@sha512:deadbeef",
  ])("rejects mutable or invalid image reference %j", (image) => {
    expect(isDigestPinnedOciImageReference(image)).toBe(false);
  });

  it("rejects repository:tag@sha256:<digest> even though digest-pinned", () => {
    expect(isDigestPinnedOciImageReference(`agent:tag@${VALID_DIGEST}`)).toBe(
      false,
    );
  });
});
