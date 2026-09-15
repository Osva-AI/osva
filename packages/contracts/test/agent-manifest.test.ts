import { describe, expect, it } from "vitest";

import { agentManifestSchema } from "../src/schemas/agent-manifest.js";

const validManifest = {
  schemaVersion: "1",
  key: "example-agent",
  name: "Example Agent",
  runtime: {
    type: "BUILTIN_PACKAGE",
    key: "example-agent",
  },
  input: {
    schema: {},
  },
  output: {
    schema: {},
  },
  execution: {
    timeoutMs: 30_000,
    maxAttempts: 2,
  },
  capabilities: {
    model: false,
    tools: [],
  },
};

describe("Agent Manifest v1", () => {
  it("parses a valid manifest", () => {
    const parsed = agentManifestSchema.parse(validManifest);
    expect(parsed.schemaVersion).toBe("1");
    expect(parsed.key).toBe("example-agent");
  });

  it("rejects an invalid schema version", () => {
    const parsed = agentManifestSchema.safeParse({
      ...validManifest,
      schemaVersion: "2",
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects a non-positive timeout", () => {
    const parsed = agentManifestSchema.safeParse({
      ...validManifest,
      execution: { timeoutMs: 0, maxAttempts: 2 },
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects a non-positive maxAttempts", () => {
    const parsed = agentManifestSchema.safeParse({
      ...validManifest,
      execution: { timeoutMs: 30_000, maxAttempts: 0 },
    });
    expect(parsed.success).toBe(false);
  });
});
