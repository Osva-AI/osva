import type { AgentVersionId } from "@osva-ai/contracts";
import { describe, expect, it } from "vitest";

import { resolveWorkflowCanvasLabel } from "../src/client/lib/workflow-canvas-labels";

describe("workflow canvas labels", () => {
  it("prefers agent name and version for AGENT nodes", () => {
    const label = resolveWorkflowCanvasLabel(
      {
        key: "agent-step-1",
        type: "AGENT",
        agentVersionId: "av-1" as AgentVersionId,
      },
      {
        agentNameByVersionId: { "av-1": "Research" },
        agentVersionNumberByVersionId: { "av-1": 2 },
      },
    );
    expect(label).toBe("Research (v2)");
  });

  it("uses approval title when present", () => {
    const label = resolveWorkflowCanvasLabel(
      {
        key: "approval-1",
        type: "APPROVAL",
        title: "Manager sign-off",
      },
      { agentNameByVersionId: {}, agentVersionNumberByVersionId: {} },
    );
    expect(label).toBe("Manager sign-off");
  });
});
