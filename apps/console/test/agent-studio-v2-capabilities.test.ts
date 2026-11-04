import { describe, expect, it } from "vitest";

import {
  clearOptionalCapabilityFromManifest,
  readOptionalCapabilitiesFromManifest,
} from "../src/client/lib/agent-studio-v2-capabilities";
import { applyKnowledgeBindingsToManifestText } from "../src/client/lib/agent-knowledge-bindings";
import { applyMemoryBindingsToManifestText } from "../src/client/lib/agent-memory-bindings";
import { applyToolBindingsToManifestText } from "../src/client/lib/agent-tool-bindings";
import {
  defaultDeclarativeManifestTemplate,
  manifestToText,
} from "../src/client/lib/declarative-agent-manifest";

describe("agent studio optional capabilities", () => {
  it("clears tool bindings from the manifest when capability is removed", () => {
    const base = manifestToText(defaultDeclarativeManifestTemplate());
    const withTools = applyToolBindingsToManifestText(base, [
      {
        bindingName: "search",
        toolId: "t1",
        toolVersionId: "tv1",
      },
    ]);
    expect(withTools).toMatch(/"search"/);
    const cleared = clearOptionalCapabilityFromManifest(withTools, "tools");
    expect(cleared).not.toMatch(/"tools"\s*:\s*\{/);
    expect(readOptionalCapabilitiesFromManifest(cleared).has("tools")).toBe(
      false,
    );
  });

  it("clears knowledge bindings when capability is removed", () => {
    const base = manifestToText(defaultDeclarativeManifestTemplate());
    const withKnowledge = applyKnowledgeBindingsToManifestText(base, [
      { bindingName: "docs", knowledgeIndexIds: ["ki-1"] },
    ]);
    const cleared = clearOptionalCapabilityFromManifest(
      withKnowledge,
      "knowledge",
    );
    expect(readOptionalCapabilitiesFromManifest(cleared).has("knowledge")).toBe(
      false,
    );
  });

  it("clears memory bindings when capability is removed", () => {
    const base = manifestToText(defaultDeclarativeManifestTemplate());
    const withMemory = applyMemoryBindingsToManifestText(base, [
      { bindingName: "session", namespaceId: "mem-1", access: "READ_ONLY" },
    ]);
    const cleared = clearOptionalCapabilityFromManifest(withMemory, "memory");
    expect(readOptionalCapabilitiesFromManifest(cleared).has("memory")).toBe(
      false,
    );
  });
});
