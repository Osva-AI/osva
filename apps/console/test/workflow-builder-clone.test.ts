import type { AgentVersionId } from "@osva-ai/contracts";
import { describe, expect, it } from "vitest";

import { createDraftForNewWorkflowVersion } from "../src/client/lib/workflow-builder-clone";

describe("workflow builder version clone", () => {
  it("creates a new-version draft with locked workflow identity", () => {
    const draft = createDraftForNewWorkflowVersion({
      workspaceId: "ws-1",
      createdWorkflowId: "wf-1",
      sourceVersionId: "ver-1",
      registry: { key: "demo", name: "Demo Workflow" },
      definition: {
        schemaVersion: "3",
        nodes: [
          {
            key: "agent-step-1",
            type: "AGENT",
            agentVersionId: "av-1" as AgentVersionId,
          },
        ],
        edges: [],
      },
    });
    expect(draft.createdWorkflowId).toBe("wf-1");
    expect(draft.editContext).toEqual({
      kind: "newVersion",
      workflowId: "wf-1",
      sourceVersionId: "ver-1",
    });
    expect(draft.registry.key).toBe("demo");
    expect(draft.definition.nodes).toHaveLength(1);
  });
});
