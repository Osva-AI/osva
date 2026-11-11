import { describe, expect, it } from "vitest";

import { registryImagePreflightCheck } from "../src/setup/prerequisite-registry.js";

describe("registry image preflight", () => {
  it("PASS when registry HEAD succeeds", async () => {
    const check = await registryImagePreflightCheck(
      async () => new Response(null, { status: 200 }),
    );
    expect(check.status).toBe("PASS");
  });

  it("WARN with remediation when registry is unreachable", async () => {
    const check = await registryImagePreflightCheck(async () => {
      throw new Error("timeout");
    }, 100);
    expect(check.status).toBe("WARN");
    expect(check.remediation).toBeTruthy();
  });
});
