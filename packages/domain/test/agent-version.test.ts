import type { AgentManifestV1 } from "@osva/contracts";
import { describe, expect, it } from "vitest";

import { AgentVersion } from "../src/agent-version.js";
import { agentId, agentVersionId, createManifest, NOW } from "./fixtures.js";

describe("AgentVersion immutability", () => {
  it("stores a cloned frozen manifest snapshot", () => {
    const manifest = {
      schemaVersion: "1" as const,
      key: "example-agent",
      name: "Example Agent",
      runtime: {
        type: "BUILTIN_PACKAGE" as const,
        key: "example-agent",
      },
      input: { schema: {} },
      output: { schema: {} },
      execution: { timeoutMs: 30_000, maxAttempts: 2 },
      capabilities: { model: true, tools: ["search"] },
    };
    const version = AgentVersion.create({
      id: agentVersionId,
      agentId,
      version: 1,
      manifest,
      createdAt: NOW,
    });

    manifest.name = "Mutated Agent";
    manifest.runtime.key = "other-runtime";
    manifest.capabilities.tools.push("shell");
    manifest.execution.timeoutMs = 1;

    expect(version.manifest.name).toBe("Example Agent");
    expect(version.manifest.runtime).toEqual({
      type: "BUILTIN_PACKAGE",
      key: "example-agent",
    });
    expect(version.manifest.capabilities.tools).toEqual(["search"]);
    expect(version.manifest.execution.timeoutMs).toBe(30_000);
    expect(Object.isFrozen(version)).toBe(true);
    expect(Object.isFrozen(version.manifest)).toBe(true);
    expect(Object.isFrozen(version.manifest.runtime)).toBe(true);
    expect(Object.isFrozen(version.manifest.capabilities)).toBe(true);
    expect(Object.isFrozen(version.manifest.capabilities.tools)).toBe(true);
  });

  it("rejects nested runtime mutation of the stored snapshot", () => {
    const version = AgentVersion.create({
      id: agentVersionId,
      agentId,
      version: 1,
      manifest: createManifest(),
      createdAt: NOW,
    });

    expect(() => {
      (version.manifest.runtime as { key: string }).key = "mutated";
    }).toThrow(TypeError);

    expect(() => {
      (version.manifest.capabilities.tools as string[]).push("fs");
    }).toThrow(TypeError);

    expect(version.manifest.runtime).toEqual({
      type: "BUILTIN_PACKAGE",
      key: "example-agent",
    });
    expect(version.manifest.capabilities.tools).toEqual([]);
  });

  it("rejects replacing version or manifest fields after construction", () => {
    const version = AgentVersion.create({
      id: agentVersionId,
      agentId,
      version: 1,
      manifest: createManifest(),
      createdAt: NOW,
    });

    expect(() => {
      (version as { version: number }).version = 2;
    }).toThrow(TypeError);

    expect(() => {
      (version as { manifest: AgentManifestV1 }).manifest = createManifest({
        name: "Next",
      });
    }).toThrow(TypeError);

    expect(version).not.toHaveProperty("withManifest");
    expect(version).not.toHaveProperty("withVersion");
    expect(version.version).toBe(1);
    expect(version.manifest.name).toBe("Example Agent");
  });
});
