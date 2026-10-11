import type { AgentVersionId } from "@osva-ai/contracts";
import { describe, expect, it } from "vitest";

import {
  addAgentNode,
  createEmptyWorkflowBuilderDraft,
  definitionForPublish,
  moveAgentNode,
  removeAgentNode,
  setAgentNodeVersion,
  validateDraftForPublish,
} from "../src/client/lib/workflow-builder-linear";

const workspaceId = "ws-test";
const av1 = "av-1" as AgentVersionId;
const av2 = "av-2" as AgentVersionId;

describe("workflow builder linear graph", () => {
  it("assigns stable node keys across reorder", () => {
    let draft = createEmptyWorkflowBuilderDraft(workspaceId);
    draft = addAgentNode(draft);
    draft = addAgentNode(draft);
    const firstKey = draft.nodeOrder[0]!;
    const secondKey = draft.nodeOrder[1]!;
    expect(firstKey).toBe("agent-step-1");
    expect(secondKey).toBe("agent-step-2");

    draft = setAgentNodeVersion(draft, firstKey, av1);
    draft = setAgentNodeVersion(draft, secondKey, av2);
    draft = moveAgentNode(draft, 0, 1);

    expect(draft.nodeOrder).toEqual([secondKey, firstKey]);
    expect(draft.definition.edges).toEqual([{ from: secondKey, to: firstKey }]);
    expect(draft.definition.nodes.map((node) => node.key)).toEqual([
      secondKey,
      firstKey,
    ]);
  });

  it("updates edges when removing a middle node", () => {
    let draft = createEmptyWorkflowBuilderDraft(workspaceId);
    draft = addAgentNode(draft, av1);
    draft = addAgentNode(draft, av2);
    draft = addAgentNode(draft, av1);
    const middle = draft.nodeOrder[1]!;
    draft = removeAgentNode(draft, middle);
    expect(draft.nodeOrder).toHaveLength(2);
    expect(draft.definition.edges).toHaveLength(1);
    expect(draft.layoutByNodeKey[middle]).toBeUndefined();
  });

  it("does not include layout in persisted definition", () => {
    let draft = createEmptyWorkflowBuilderDraft(workspaceId);
    draft = addAgentNode(draft, av1);
    draft = {
      ...draft,
      registry: { key: "wf", name: "WF" },
    };
    const definition = definitionForPublish(draft);
    expect(JSON.stringify(definition)).not.toContain("layoutByNodeKey");
    expect(Object.keys(draft.layoutByNodeKey).length).toBeGreaterThan(0);
  });

  it("validates agent version selection before publish", () => {
    let draft = createEmptyWorkflowBuilderDraft(workspaceId);
    draft = addAgentNode(draft);
    draft = {
      ...draft,
      registry: { key: "wf", name: "WF" },
    };
    const invalid = validateDraftForPublish(draft);
    expect(invalid.ok).toBe(false);

    draft = setAgentNodeVersion(draft, draft.nodeOrder[0]!, av1);
    const valid = validateDraftForPublish(draft);
    expect(valid.ok).toBe(true);
  });
});
