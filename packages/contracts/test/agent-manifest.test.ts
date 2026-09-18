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

const validContainerDigest = `sha256:${"b".repeat(64)}`;

const validContainerRuntime = {
  type: "CONTAINER",
  protocolVersion: "1",
  image: `registry.example.com/agent@${validContainerDigest}`,
  command: ["node", "dist/index.js"],
  resources: {
    cpuMillis: 500,
    memoryMiB: 256,
    pids: 128,
  },
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

  it("parses optional logical model bindings", () => {
    const parsed = agentManifestSchema.parse({
      ...validManifest,
      models: {
        primary: { modelProfileVersionId: "mpv-1" },
      },
    });
    expect(parsed.models).toEqual({
      primary: { modelProfileVersionId: "mpv-1" },
    });
  });

  it("rejects an invalid model binding name", () => {
    const parsed = agentManifestSchema.safeParse({
      ...validManifest,
      models: {
        "not a name": { modelProfileVersionId: "mpv-1" },
      },
    });
    expect(parsed.success).toBe(false);
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

  it("parses a valid remote HTTP runtime descriptor", () => {
    const runtime = {
      type: "REMOTE_HTTP",
      protocolVersion: "1",
      endpoint: "https://runtime.example.com/execute",
      authSecretRef: { key: "OSVA_REMOTE_RUNTIME_TOKEN" },
      timeoutMs: 15_000,
    };
    const parsed = agentManifestSchema.parse({
      ...validManifest,
      runtime,
    });
    expect(parsed.runtime).toEqual(runtime);
  });

  it.each([
    "ftp://runtime.example.com/execute",
    "file:///tmp/execute",
    "https://user:pass@runtime.example.com/execute",
    "https://",
    "not-a-url",
    "",
  ])("rejects invalid remote HTTP endpoint %j", (endpoint) => {
    const parsed = agentManifestSchema.safeParse({
      ...validManifest,
      runtime: {
        type: "REMOTE_HTTP",
        protocolVersion: "1",
        endpoint,
      },
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects unsupported remote protocol versions and plaintext credentials", () => {
    expect(
      agentManifestSchema.safeParse({
        ...validManifest,
        runtime: {
          type: "REMOTE_HTTP",
          protocolVersion: "2",
          endpoint: "https://runtime.example.com/execute",
        },
      }).success,
    ).toBe(false);

    expect(
      agentManifestSchema.safeParse({
        ...validManifest,
        runtime: {
          type: "REMOTE_HTTP",
          protocolVersion: "1",
          endpoint: "https://runtime.example.com/execute",
          apiKey: "plaintext",
        },
      }).success,
    ).toBe(false);

    expect(
      agentManifestSchema.safeParse({
        ...validManifest,
        runtime: {
          type: "REMOTE_HTTP",
          protocolVersion: "1",
          endpoint: "https://runtime.example.com/execute",
          allowPrivateNetworks: true,
        },
      }).success,
    ).toBe(false);

    expect(
      agentManifestSchema.safeParse({
        ...validManifest,
        runtime: {
          type: "REMOTE_HTTP",
          protocolVersion: "1",
          endpoint: "https://runtime.example.com/execute",
          timeoutMs: 99,
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

  it("parses a valid CONTAINER runtime descriptor", () => {
    const parsed = agentManifestSchema.parse({
      ...validManifest,
      runtime: validContainerRuntime,
    });
    expect(parsed.runtime).toEqual(validContainerRuntime);
  });

  it("parses a CONTAINER runtime without optional command or resources", () => {
    const runtime = {
      type: "CONTAINER",
      protocolVersion: "1",
      image: `registry.example.com/agent@${validContainerDigest}`,
    };
    const parsed = agentManifestSchema.parse({
      ...validManifest,
      runtime,
    });
    expect(parsed.runtime).toEqual(runtime);
  });

  it.each(["agent:latest", "agent:v1", `agent:tag@${validContainerDigest}`])(
    "rejects mutable or tag-suffixed CONTAINER image %j",
    (image) => {
      const parsed = agentManifestSchema.safeParse({
        ...validManifest,
        runtime: {
          type: "CONTAINER",
          protocolVersion: "1",
          image,
        },
      });
      expect(parsed.success).toBe(false);
    },
  );

  it("rejects unsupported CONTAINER protocol versions and extra runtime fields", () => {
    expect(
      agentManifestSchema.safeParse({
        ...validManifest,
        runtime: {
          type: "CONTAINER",
          protocolVersion: "2",
          image: `registry.example.com/agent@${validContainerDigest}`,
        },
      }).success,
    ).toBe(false);

    expect(
      agentManifestSchema.safeParse({
        ...validManifest,
        runtime: {
          ...validContainerRuntime,
          timeoutMs: 15_000,
        },
      }).success,
    ).toBe(false);
  });
});
