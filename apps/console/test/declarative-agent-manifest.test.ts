import { describe, expect, it } from "vitest";

import {
  applyDeclarativeStudioPatch,
  applyPrimaryModelToManifest,
  defaultDeclarativeManifestTemplate,
  describeDeclarativeManifestValidation,
  extractDeclarativeStudioFields,
  manifestToText,
  parseManifestRecord,
  slugAgentKeyFromName,
  syncDeclarativeToolBudgets,
} from "../src/client/lib/declarative-agent-manifest";
import { applyToolBindingsToManifestText } from "../src/client/lib/agent-tool-bindings";

describe("declarative agent manifest studio", () => {
  it("creates a declarative template with valid defaults", () => {
    const manifest = defaultDeclarativeManifestTemplate({
      key: "support-bot",
      name: "Support Bot",
    });
    expect(manifest.runtime).toMatchObject({ type: "DECLARATIVE" });
    const validation = describeDeclarativeManifestValidation(manifest);
    expect(validation.fieldErrors.instructions).toBeDefined();
    expect(validation.fieldErrors.model).toBeDefined();
  });

  it("generates workspace keys from display names", () => {
    expect(slugAgentKeyFromName("  Acme Support Bot  ")).toBe(
      "acme-support-bot",
    );
  });

  it("binds a selected model without dropping unrelated manifest fields", () => {
    const base = defaultDeclarativeManifestTemplate({
      key: "bot",
      name: "Bot",
    });
    const withInstructions = applyDeclarativeStudioPatch(base, {
      instructions: "Answer politely.",
    });
    const withModel = applyPrimaryModelToManifest(
      withInstructions,
      "mpv-test-1",
    );
    expect(withModel.models).toEqual({
      primary: { modelProfileVersionId: "mpv-test-1" },
    });
    expect(withModel.capabilities).toEqual({ model: true, tools: [] });
    const runtime = withModel.runtime as { config: { modelBinding: string } };
    expect(runtime.config.modelBinding).toBe("primary");
    const validation = describeDeclarativeManifestValidation(withModel);
    expect(validation.ok).toBe(true);
  });

  it("syncs tool grants and clears stale budgets when tools are removed", () => {
    const base = applyPrimaryModelToManifest(
      applyDeclarativeStudioPatch(
        defaultDeclarativeManifestTemplate({ key: "bot", name: "Bot" }),
        { instructions: "Use tools carefully." },
      ),
      "mpv-1",
    );
    const text = applyToolBindingsToManifestText(manifestToText(base), [
      {
        bindingName: "search",
        toolId: "tool-1",
        toolVersionId: "tv-1",
      },
    ]);
    const withTool = parseManifestRecord(text);
    expect(withTool.ok).toBe(true);
    if (!withTool.ok) {
      return;
    }
    const runtime = withTool.value.runtime as {
      config: { allowedToolBindings: string[]; maxToolInvocations: number };
    };
    expect(runtime.config.allowedToolBindings).toEqual(["search"]);
    expect(runtime.config.maxToolInvocations).toBeGreaterThan(0);

    const cleared = applyToolBindingsToManifestText(text, []);
    const parsedCleared = parseManifestRecord(cleared);
    expect(parsedCleared.ok).toBe(true);
    if (!parsedCleared.ok) {
      return;
    }
    const clearedRuntime = parsedCleared.value.runtime as {
      config: { allowedToolBindings: string[]; maxToolInvocations: number };
    };
    expect(clearedRuntime.config.allowedToolBindings).toEqual([]);
    expect(clearedRuntime.config.maxToolInvocations).toBe(0);
    expect(parsedCleared.value.tools).toBeUndefined();
  });

  it("validates empty instructions and missing model bindings", () => {
    const manifest = defaultDeclarativeManifestTemplate();
    const validation = describeDeclarativeManifestValidation(manifest);
    expect(validation.ok).toBe(false);
    expect(validation.fieldErrors.instructions).toMatch(/required/i);
    expect(validation.fieldErrors.model).toMatch(/model/i);
  });

  it("preserves advanced runtime config when switching guided field patches", () => {
    const manifest = applyPrimaryModelToManifest(
      applyDeclarativeStudioPatch(
        defaultDeclarativeManifestTemplate({ key: "bot", name: "Bot" }),
        {
          instructions: "Stay on topic.",
          maxOutputTokens: "4096",
          useCustomOutputSchema: true,
          outputSchemaText: JSON.stringify({
            type: "object",
            required: ["answer"],
            properties: { answer: { type: "string" } },
          }),
        },
      ),
      "mpv-1",
    );
    const reparsed = applyDeclarativeStudioPatch(manifest, {
      instructions: "Stay on topic and cite sources.",
    });
    const fields = extractDeclarativeStudioFields(reparsed);
    expect(fields.useCustomOutputSchema).toBe(true);
    expect(fields.maxOutputTokens).toBe("4096");
    expect(describeDeclarativeManifestValidation(reparsed).ok).toBe(true);
  });

  it("enforces tool budget constraints through canonical validation", () => {
    const manifest = syncDeclarativeToolBudgets(
      applyPrimaryModelToManifest(
        applyDeclarativeStudioPatch(
          defaultDeclarativeManifestTemplate({ key: "bot", name: "Bot" }),
          { instructions: "No tools", maxToolInvocations: "4" },
        ),
        "mpv-1",
      ),
    );
    const validation = describeDeclarativeManifestValidation(manifest);
    expect(validation.ok).toBe(true);
  });
});
