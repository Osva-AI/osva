import { describe, expect, it } from "vitest";

import {
  createAgentRequestSchema,
  createAgentVersionRequestSchema,
  updateAgentRequestSchema,
} from "../src/schemas/agent-registry.js";

const validManifest = {
  schemaVersion: "1",
  key: "example-agent",
  name: "Example Agent",
  runtime: {
    type: "BUILTIN_PACKAGE",
    key: "example-agent",
  },
  input: { schema: {} },
  output: { schema: {} },
  execution: { timeoutMs: 30_000, maxAttempts: 2 },
  capabilities: { model: false, tools: [] },
};

describe("Agent Registry request schemas", () => {
  it("parses a create Agent request", () => {
    const parsed = createAgentRequestSchema.parse({
      workspaceId: "ws-1",
      key: "example-agent",
      name: "Example Agent",
    });

    expect(parsed.key).toBe("example-agent");
  });

  it("rejects client-supplied Agent identity and timestamps", () => {
    const parsed = createAgentRequestSchema.safeParse({
      id: "agent-1",
      workspaceId: "ws-1",
      key: "example-agent",
      name: "Example Agent",
      createdAt: "2026-01-15T12:00:00.000Z",
    });

    expect(parsed.success).toBe(false);
  });

  it("parses an update Agent request that only allows name", () => {
    const parsed = updateAgentRequestSchema.parse({ name: "Renamed Agent" });
    expect(parsed.name).toBe("Renamed Agent");
  });

  it("rejects AgentVersion creation payloads that choose a version number", () => {
    const parsed = createAgentVersionRequestSchema.safeParse({
      version: 7,
      manifest: validManifest,
    });

    expect(parsed.success).toBe(false);
  });

  it("parses an AgentVersion creation payload that only supplies a manifest", () => {
    const parsed = createAgentVersionRequestSchema.parse({
      manifest: validManifest,
    });

    expect(parsed.manifest.key).toBe("example-agent");
  });
});
