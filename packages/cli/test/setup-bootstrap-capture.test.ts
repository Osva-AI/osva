import { describe, expect, it } from "vitest";

import {
  parseIdentityBootstrapSetupToken,
  parseWorkspaceBootstrapOutput,
  redactBootstrapSubprocessOutput,
} from "../src/setup/bootstrap-capture.js";

describe("setup bootstrap capture", () => {
  it("parses workspace bootstrap output and redacts API keys from failures", () => {
    const stdout = [
      "OSVA installation bootstrap completed.",
      "Workspace ID: 11111111-1111-1111-1111-111111111111",
      "Copy the API key below now. It cannot be retrieved again:",
      "osva_ak_test.secretpart",
      "",
    ].join("\n");
    const parsed = parseWorkspaceBootstrapOutput(stdout);
    expect(parsed.workspaceId).toBe("11111111-1111-1111-1111-111111111111");
    expect(parsed.apiKey).toMatch(/^osva_ak_/);
    expect(redactBootstrapSubprocessOutput(stdout)).not.toContain(
      "osva_ak_test.secretpart",
    );
  });

  it("parses identity bootstrap setup tokens and redacts them from subprocess logs", () => {
    const stdout = [
      "OSVA identity bootstrap completed.",
      "One-time password setup token (single use; do not log or share):",
      "setup-token-value",
      "",
      "Complete setup: POST http://127.0.0.1:8080/v1/auth/setup/complete",
      "",
    ].join("\n");
    expect(parseIdentityBootstrapSetupToken(stdout)).toBe("setup-token-value");
    expect(redactBootstrapSubprocessOutput(stdout)).not.toContain(
      "setup-token-value",
    );
  });
});
