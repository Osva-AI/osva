import { describe, expect, it } from "vitest";

import {
  applyKnowledgeBindingsToManifestText,
  extractKnowledgeBindingRows,
} from "../src/client/lib/agent-knowledge-bindings";

describe("agent knowledge bindings", () => {
  it("round-trips knowledge bindings through manifest text", () => {
    const manifest = JSON.stringify(
      {
        schemaVersion: "1",
        key: "agent",
        name: "Agent",
        runtime: {
          type: "DECLARATIVE",
          config: {
            configVersion: "1",
            instructions: "x",
            modelBinding: "primary",
            allowedToolBindings: [],
            maxModelInvocations: 1,
            maxToolInvocations: 0,
          },
        },
      },
      null,
      2,
    );

    const next = applyKnowledgeBindingsToManifestText(manifest, [
      { bindingName: "docs", knowledgeIndexIds: ["ki-1", "ki-2"] },
    ]);

    const rows = extractKnowledgeBindingRows(JSON.parse(next));
    expect(rows).toEqual([
      { bindingName: "docs", knowledgeIndexIds: ["ki-1", "ki-2"] },
    ]);
  });
});
