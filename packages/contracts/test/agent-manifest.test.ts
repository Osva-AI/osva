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

const validTrustedRuntime = {
  type: "TRUSTED_TYPESCRIPT",
  entrypoint: "echo-agent.ts",
  integrity: `sha256:${"a".repeat(64)}`,
};

describe("Agent Manifest v1", () => {
  it("parses a valid manifest", () => {
    const parsed = agentManifestSchema.parse(validManifest);
    expect(parsed.schemaVersion).toBe("1");
    expect(parsed.key).toBe("example-agent");
  });

  it("parses a valid trusted TypeScript runtime descriptor", () => {
    const parsed = agentManifestSchema.parse({
      ...validManifest,
      runtime: validTrustedRuntime,
    });
    expect(parsed.runtime).toEqual(validTrustedRuntime);
  });

  it("rejects an invalid schema version", () => {
    const parsed = agentManifestSchema.safeParse({
      ...validManifest,
      schemaVersion: "2",
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects a timeout below the minimum", () => {
    const parsed = agentManifestSchema.safeParse({
      ...validManifest,
      execution: { timeoutMs: 99, maxAttempts: 2 },
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects a timeout above the maximum", () => {
    const parsed = agentManifestSchema.safeParse({
      ...validManifest,
      execution: { timeoutMs: 300_001, maxAttempts: 2 },
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

  it.each([
    "/abs/echo-agent.ts",
    "C:\\trusted\\echo-agent.ts",
    "../echo-agent.ts",
    "nested/../echo-agent.ts",
    "..\\echo-agent.ts",
    "",
    "echo-agent.ts\0.js",
  ])("rejects unsafe trusted TypeScript entrypoint %j", (entrypoint) => {
    const parsed = agentManifestSchema.safeParse({
      ...validManifest,
      runtime: {
        ...validTrustedRuntime,
        entrypoint,
      },
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects inline source, absolute command, and extra runtime fields", () => {
    expect(
      agentManifestSchema.safeParse({
        ...validManifest,
        runtime: {
          ...validTrustedRuntime,
          source: "export async function run() { return 1; }",
        },
      }).success,
    ).toBe(false);

    expect(
      agentManifestSchema.safeParse({
        ...validManifest,
        runtime: {
          type: "TRUSTED_TYPESCRIPT",
          entrypoint: "echo-agent.ts",
          integrity: validTrustedRuntime.integrity,
          command: "node echo-agent.ts",
        },
      }).success,
    ).toBe(false);
  });

  it("rejects a non-sha256 integrity digest", () => {
    const parsed = agentManifestSchema.safeParse({
      ...validManifest,
      runtime: {
        ...validTrustedRuntime,
        integrity: "md5:deadbeef",
      },
    });
    expect(parsed.success).toBe(false);
  });
});
