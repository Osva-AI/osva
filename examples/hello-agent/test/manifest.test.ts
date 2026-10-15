import type { AgentManifestV1 } from "@osva-ai/contracts";
import { describe, expect, it } from "vitest";

import {
  buildHelloAgentManifest,
  manifestFingerprint,
  manifestsMatch,
} from "../scripts/lib/manifest.js";
import { isSha256IntegrityDigest } from "../scripts/lib/integrity.js";

describe("Hello Agent manifest", () => {
  it("builds a valid TRUSTED_TYPESCRIPT manifest", async () => {
    const digest = `sha256:${"a".repeat(64)}`;
    expect(isSha256IntegrityDigest(digest)).toBe(true);
    const manifest = await buildHelloAgentManifest({ integrity: digest });
    expect(manifest.runtime.type).toBe("TRUSTED_TYPESCRIPT");
    expect(manifest.capabilities.model).toBe(false);
    expect(manifest.capabilities.tools).toEqual([]);
    expect(manifest.input.schema).toMatchObject({
      required: ["message"],
    });
    expect(manifest.output.schema).toMatchObject({
      required: ["echoed"],
    });
  });

  it("fingerprints manifests for safe reuse", async () => {
    const digest = `sha256:${"b".repeat(64)}`;
    const left = await buildHelloAgentManifest({ integrity: digest });
    const right = await buildHelloAgentManifest({ integrity: digest });
    expect(manifestsMatch(left, right)).toBe(true);
    const other = await buildHelloAgentManifest({
      integrity: `sha256:${"c".repeat(64)}`,
    });
    expect(manifestsMatch(left, other)).toBe(false);
  });

  it("treats JSON Schema property order as irrelevant (API jsonb round-trip)", async () => {
    const digest = `sha256:${"d".repeat(64)}`;
    const fromSetup = await buildHelloAgentManifest({ integrity: digest });
    const fromApi: AgentManifestV1 = {
      ...fromSetup,
      input: {
        schema: {
          properties: { message: { type: "string", minLength: 1 } },
          required: ["message"],
          type: "object",
          additionalProperties: false,
          $schema: "https://json-schema.org/draft/2020-12/schema",
        },
      },
    };
    expect(manifestsMatch(fromApi, fromSetup)).toBe(true);
    expect(manifestFingerprint(fromApi)).toBe(manifestFingerprint(fromSetup));
  });
});
