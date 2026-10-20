import type { AgentManifestV1 } from "@osva-ai/contracts";
import { describe, expect, it } from "vitest";

import { assertValidAgentManifest } from "../src/agent-manifest-validation.js";
import { InvalidAgentManifestError } from "../src/errors.js";

describe("assertValidAgentManifest", () => {
  it("accepts a minimal builtin manifest without mutating the input", () => {
    const manifest: AgentManifestV1 = {
      schemaVersion: "1",
      key: "example",
      name: "Example",
      runtime: { type: "BUILTIN_PACKAGE", key: "example" },
      input: { schema: {} },
      output: { schema: {} },
      execution: { timeoutMs: 30_000, maxAttempts: 1 },
      capabilities: { model: false, tools: [] },
    };
    const snapshot = structuredClone(manifest);

    expect(() => assertValidAgentManifest(manifest)).not.toThrow();
    expect(manifest).toEqual(snapshot);
  });

  it("rejects declarative cross-field violations with a domain error", () => {
    const manifest = {
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
    } as unknown as AgentManifestV1;

    expect(() => assertValidAgentManifest(manifest)).toThrow(
      InvalidAgentManifestError,
    );
  });
});
