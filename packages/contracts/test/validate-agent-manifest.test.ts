import { describe, expect, it } from "vitest";

import { validateAgentManifest } from "../src/validate-agent-manifest.js";

describe("validateAgentManifest", () => {
  it("returns ok for a valid builtin manifest", () => {
    const manifest = {
      schemaVersion: "1",
      key: "example",
      name: "Example",
      runtime: { type: "BUILTIN_PACKAGE", key: "example" },
      input: { schema: {} },
      output: { schema: {} },
      execution: { timeoutMs: 30_000, maxAttempts: 1 },
      capabilities: { model: false, tools: [] },
    };

    const result = validateAgentManifest(manifest);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.manifest).toEqual(manifest);
    }
  });

  it("returns messages for declarative cross-field violations", () => {
    const result = validateAgentManifest({
      schemaVersion: "1",
      key: "declarative",
      name: "Declarative",
      runtime: {
        type: "DECLARATIVE",
        config: {
          configVersion: "1",
          instructions: "Hi",
          modelBinding: "missing",
          allowedToolBindings: [],
          maxModelInvocations: 1,
          maxToolInvocations: 0,
        },
      },
      input: { schema: {} },
      output: { schema: {} },
      execution: { timeoutMs: 30_000, maxAttempts: 1 },
      capabilities: { model: true, tools: [] },
      models: {
        primary: { modelProfileVersionId: "mpv-1" },
      },
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.messages.join(" ")).toMatch(/manifest\.models/);
    }
  });
});
