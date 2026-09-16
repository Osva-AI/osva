import { describe, expect, it } from "vitest";

import { loadWorkflowOrchestratorConfig } from "../src/config.js";

describe("workflow orchestrator config", () => {
  it("loads required env vars and defaults poll interval", () => {
    const config = loadWorkflowOrchestratorConfig({
      OSVA_DATABASE_URL: "postgres://example",
      OSVA_VALKEY_URL: "redis://example",
    });

    expect(config.databaseUrl).toBe("postgres://example");
    expect(config.valkeyUrl).toBe("redis://example");
    expect(config.pollMs).toBe(1_000);
  });

  it("rejects poll intervals outside supported bounds", () => {
    expect(() =>
      loadWorkflowOrchestratorConfig({
        OSVA_DATABASE_URL: "postgres://example",
        OSVA_VALKEY_URL: "redis://example",
        OSVA_WORKFLOW_ORCHESTRATOR_POLL_MS: "10",
      }),
    ).toThrow(/OSVA_WORKFLOW_ORCHESTRATOR_POLL_MS/);
  });
});
