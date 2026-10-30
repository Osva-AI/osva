import { describe, expect, it } from "vitest";

import { formatSetupHuman, formatSetupJson } from "../src/setup/format.js";
import type { SetupReport } from "../src/setup/setup-report.js";

describe("setup report formatting", () => {
  it("prints setup tokens in human output only", () => {
    const report: SetupReport = {
      result: "pass",
      phase: "provision",
      checks: [],
      setupTokenForOperator: "secret-setup-token",
      platformReady: true,
      consoleReady: true,
      administratorBootstrapped: true,
      installationComplete: false,
    };
    const human = formatSetupHuman(report);
    expect(human).toContain("secret-setup-token");
    const json = formatSetupJson(report);
    expect(json).not.toContain("secret-setup-token");
    expect(json).not.toContain("setupTokenForOperator");
  });
});
