import { describe, expect, it } from "vitest";

import { sanitizePublicErrorMessage } from "../src/public-error.js";

const FAKE_OSVA_API_KEY = "FAKE_OSVA_API_KEY_DO_NOT_USE";
const FAKE_PROVIDER_SECRET = "FAKE_PROVIDER_SECRET_DO_NOT_USE";

describe("sanitizePublicErrorMessage", () => {
  it("redacts synthetic provider secrets and sk-* tokens from the first line", () => {
    const message = `Tool failed: Bearer ${FAKE_PROVIDER_SECRET} OPENAI_API_KEY=${FAKE_OSVA_API_KEY} sk-live-abc123`;
    const sanitized = sanitizePublicErrorMessage(message, "fallback");
    expect(sanitized).not.toContain(FAKE_PROVIDER_SECRET);
    expect(sanitized).not.toContain("sk-live-abc123");
    expect(sanitized).toContain("[redacted]");
  });
});
