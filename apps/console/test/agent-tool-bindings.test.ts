import { describe, expect, it } from "vitest";

import { helloAgentManifestJson } from "../src/client/lib/agent-example";
import {
  applyToolBindingsToManifestText,
  extractToolBindingRows,
} from "../src/client/lib/agent-tool-bindings";

describe("agent tool bindings", () => {
  it("round-trips tool bindings without removing model bindings", () => {
    const base = helloAgentManifestJson();
    const withModel = JSON.stringify(
      {
        ...JSON.parse(base),
        models: { primary: { modelProfileVersionId: "mpv-1" } },
        capabilities: { model: true, tools: [] },
      },
      null,
      2,
    );
    const updated = applyToolBindingsToManifestText(withModel, [
      {
        bindingName: "search",
        toolId: "tool-1",
        toolVersionId: "tv-1",
      },
    ]);
    const parsed = JSON.parse(updated) as {
      models?: unknown;
      tools?: Record<string, { toolVersionId: string }>;
      capabilities?: { tools: string[] };
    };
    expect(parsed.models).toEqual({
      primary: { modelProfileVersionId: "mpv-1" },
    });
    expect(parsed.tools).toEqual({ search: { toolVersionId: "tv-1" } });
    expect(parsed.capabilities?.tools).toEqual(["search"]);
    expect(extractToolBindingRows(parsed)).toEqual([
      { bindingName: "search", toolId: "", toolVersionId: "tv-1" },
    ]);
  });
});
