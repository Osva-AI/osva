import type { AgentVersionId } from "@osva-ai/contracts";
import { describe, expect, it } from "vitest";

import { createEmptyWorkflowBuilderDraft } from "../src/client/lib/workflow-builder-draft";
import { validateDraftForPublish } from "../src/client/lib/workflow-builder-draft";
import {
  addWorkflowNode,
  connectWorkflowNodes,
  disconnectWorkflowEdge,
  removeWorkflowNode,
  setAgentNodeVersion,
  setNodeLayout,
} from "../src/client/lib/workflow-builder-graph";

const workspaceId = "ws-test";
const av1 = "av-1" as AgentVersionId;

describe("workflow builder graph", () => {
  it("assigns stable keys per node type", () => {
    let draft = createEmptyWorkflowBuilderDraft(workspaceId);
    draft = addWorkflowNode(draft, "AGENT");
    draft = addWorkflowNode(draft, "PARALLEL");
    expect(draft.definition.nodes.map((node) => node.key)).toEqual([
      "agent-step-1",
      "parallel-2",
    ]);
  });

  it("persists layout separately from definition", () => {
    let draft = createEmptyWorkflowBuilderDraft(workspaceId);
    draft = addWorkflowNode(draft, "AGENT");
    const key = draft.definition.nodes[0]!.key;
    draft = setNodeLayout(draft, key, { x: 120, y: 200 });
    expect(draft.layoutByNodeKey[key]).toEqual({ x: 120, y: 200 });
    expect(JSON.stringify(draft.definition)).not.toContain("layoutByNodeKey");
  });

  it("connects and disconnects edges without duplicating", () => {
    let draft = createEmptyWorkflowBuilderDraft(workspaceId);
    draft = addWorkflowNode(draft, "AGENT");
    draft = addWorkflowNode(draft, "AGENT");
    const a = draft.definition.nodes[0]!.key;
    const b = draft.definition.nodes[1]!.key;
    draft = connectWorkflowNodes(draft, a, b);
    draft = connectWorkflowNodes(draft, a, b);
    expect(draft.definition.edges).toEqual([{ from: a, to: b }]);
    draft = disconnectWorkflowEdge(draft, a, b);
    expect(draft.definition.edges).toEqual([]);
  });

  it("removes incident edges when deleting a node", () => {
    let draft = createEmptyWorkflowBuilderDraft(workspaceId);
    draft = addWorkflowNode(draft, "AGENT");
    draft = addWorkflowNode(draft, "AGENT");
    const a = draft.definition.nodes[0]!.key;
    const b = draft.definition.nodes[1]!.key;
    draft = connectWorkflowNodes(draft, a, b);
    draft = removeWorkflowNode(draft, a);
    expect(draft.definition.nodes).toHaveLength(1);
    expect(draft.definition.edges).toHaveLength(0);
  });

  it("blocks publish until domain validation passes", () => {
    let draft = createEmptyWorkflowBuilderDraft(workspaceId);
    draft = addWorkflowNode(draft, "AGENT");
    draft = { ...draft, registry: { key: "wf", name: "WF" } };
    expect(validateDraftForPublish(draft).ok).toBe(false);

    const key = draft.definition.nodes[0]!.key;
    draft = setAgentNodeVersion(draft, key, av1);
    expect(validateDraftForPublish(draft).ok).toBe(true);
  });

  it("accepts a parallel/join graph when fully wired", () => {
    let draft = createEmptyWorkflowBuilderDraft(workspaceId);
    draft = addWorkflowNode(draft, "PARALLEL");
    draft = addWorkflowNode(draft, "AGENT");
    draft = setAgentNodeVersion(draft, draft.definition.nodes[1]!.key, av1);
    draft = addWorkflowNode(draft, "AGENT");
    draft = setAgentNodeVersion(draft, draft.definition.nodes[2]!.key, av1);
    draft = addWorkflowNode(draft, "JOIN");
    const [fork, left, right, join] = draft.definition.nodes.map(
      (node) => node.key,
    );
    draft = connectWorkflowNodes(draft, fork!, left!);
    draft = connectWorkflowNodes(draft, fork!, right!);
    draft = connectWorkflowNodes(draft, left!, join!);
    draft = connectWorkflowNodes(draft, right!, join!);
    draft = { ...draft, registry: { key: "wf", name: "WF" } };
    expect(validateDraftForPublish(draft).ok).toBe(true);
  });
});
