import { describe, expect, it } from "vitest";

import { resolveAgentBindingsFromCatalog } from "../src/client/lib/workflow-builder-agent-bindings";

describe("resolveAgentBindingsFromCatalog", () => {
  it("maps bound version ids to owning agents", () => {
    const resolved = resolveAgentBindingsFromCatalog(
      [
        { key: "agent-step-1", agentVersionId: "av-1" },
        { key: "agent-step-2", agentVersionId: "av-2" },
      ],
      [
        {
          agentId: "agent-a",
          versions: [{ id: "av-1" }],
        },
        {
          agentId: "agent-b",
          versions: [{ id: "av-2" }],
        },
      ],
    );
    expect(resolved.agentIdByNodeKey).toEqual({
      "agent-step-1": "agent-a",
      "agent-step-2": "agent-b",
    });
    expect(resolved.unavailableVersionByNodeKey).toEqual({});
  });

  it("marks bindings unavailable when no catalog entry matches", () => {
    const resolved = resolveAgentBindingsFromCatalog(
      [{ key: "agent-step-1", agentVersionId: "av-missing" }],
      [
        {
          agentId: "agent-a",
          versions: [{ id: "av-1" }],
        },
      ],
    );
    expect(resolved.agentIdByNodeKey).toEqual({});
    expect(resolved.unavailableVersionByNodeKey).toEqual({
      "agent-step-1": true,
    });
  });
});
