import { describe, expect, it } from "vitest";

import { createRunRequestSchema } from "../src/schemas/run-lifecycle.js";

describe("Run creation request schema", () => {
  it("parses a request that names the AgentVersion directly", () => {
    const parsed = createRunRequestSchema.parse({
      agentId: "agent-1",
      agentVersionId: "agent-version-1",
      input: { prompt: "hello" },
    });

    expect(parsed.agentVersionId).toBe("agent-version-1");
  });

  it("rejects a client-authored effectiveBindings object", () => {
    const parsed = createRunRequestSchema.safeParse({
      agentId: "agent-1",
      agentVersionId: "agent-version-1",
      effectiveBindings: {
        agentVersionId: "agent-version-1",
        modelProfileVersionBindings: {},
      },
      input: { prompt: "hello" },
    });

    expect(parsed.success).toBe(false);
  });
});
