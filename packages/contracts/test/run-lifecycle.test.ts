import { describe, expect, it } from "vitest";

import {
  createRunRequestSchema,
  runAttemptResourceSchema,
} from "../src/schemas/run-lifecycle.js";

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

describe("RunAttempt resource schema", () => {
  const baseAttempt = {
    id: "attempt-1",
    runId: "run-1",
    sequence: 1,
    status: "PENDING" as const,
    createdAt: "2026-01-15T12:00:00.000Z",
  };

  it("accepts a legacy attempt without execution diagnostics", () => {
    expect(runAttemptResourceSchema.parse(baseAttempt)).toEqual(baseAttempt);
  });

  it("accepts additive execution diagnostics and rejects raw owner fields", () => {
    const parsed = runAttemptResourceSchema.parse({
      ...baseAttempt,
      execution: {
        state: "queued",
        leased: false,
        executionGeneration: 0,
        interrupted: false,
        observedAt: "2026-01-15T12:00:00.000Z",
      },
    });
    expect(parsed.execution?.state).toBe("queued");
    expect(
      runAttemptResourceSchema.safeParse({
        ...baseAttempt,
        executionOwner: "worker-1",
      }).success,
    ).toBe(false);
  });
});
