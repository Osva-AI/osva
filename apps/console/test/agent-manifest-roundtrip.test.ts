import { describe, expect, it } from "vitest";

import {
  applyDeclarativeStudioPatch,
  applyPrimaryModelToManifest,
  defaultDeclarativeManifestTemplate,
  extractDeclarativeStudioFields,
  manifestToText,
  parseManifestRecord,
} from "../src/client/lib/declarative-agent-manifest";
import { describeManifestAssurance } from "../src/client/lib/agent-studio-assurance";

describe("agent manifest guided/advanced round-trip", () => {
  it("preserves unknown valid manifest fields through guided patches", () => {
    const base = {
      ...defaultDeclarativeManifestTemplate({ key: "bot", name: "Bot" }),
      metadata: { team: "platform", tier: "internal" },
    };
    const withModel = applyPrimaryModelToManifest(
      applyDeclarativeStudioPatch(base, {
        instructions: "Help users.",
      }),
      "mpv-roundtrip",
    );
    const guidedText = manifestToText(withModel);
    const invalidAttempt = "{ not-json";
    expect(parseManifestRecord(invalidAttempt).ok).toBe(false);
    expect(describeManifestAssurance(invalidAttempt).level).toBe(
      "syntax-invalid",
    );

    const reparsed = parseManifestRecord(guidedText);
    expect(reparsed.ok).toBe(true);
    if (!reparsed.ok) {
      return;
    }
    expect(reparsed.value.metadata).toEqual({
      team: "platform",
      tier: "internal",
    });

    const advancedEdited = manifestToText({
      ...reparsed.value,
      runtime: {
        ...(reparsed.value.runtime as Record<string, unknown>),
        config: {
          ...((reparsed.value.runtime as { config: Record<string, unknown> })
            .config ?? {}),
          instructions: "Help users with billing only.",
        },
      },
    });
    const afterAdvanced = parseManifestRecord(advancedEdited);
    expect(afterAdvanced.ok).toBe(true);
    if (!afterAdvanced.ok) {
      return;
    }
    const fields = extractDeclarativeStudioFields(afterAdvanced.value);
    expect(fields.instructions).toBe("Help users with billing only.");
    expect(afterAdvanced.value.metadata).toEqual({
      team: "platform",
      tier: "internal",
    });
  });

  it("keeps invalid JSON out of guided patch helpers", () => {
    const broken = '{ "schemaVersion": "1", "key": ';
    const parsed = parseManifestRecord(broken);
    expect(parsed.ok).toBe(false);
    if (parsed.ok) {
      return;
    }
    expect(parsed.message.length).toBeGreaterThan(0);
    expect(broken).toBe(broken);
  });
});
