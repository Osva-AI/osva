import { describe, expect, it } from "vitest";

import { addWorkflowNode } from "../src/client/lib/workflow-builder-graph";
import { createEmptyWorkflowBuilderDraft } from "../src/client/lib/workflow-builder-linear";
import {
  tryConnectWorkflowNodes,
  tryDisconnectWorkflowEdge,
} from "../src/client/lib/workflow-builder-graph-connection";

describe("workflow builder graph connection helpers", () => {
  it("connects and disconnects steps with feedback", () => {
    let draft = createEmptyWorkflowBuilderDraft("ws-1");
    draft = addWorkflowNode(draft, "AGENT");
    draft = addWorkflowNode(draft, "AGENT");
    const [first, second] = draft.definition.nodes.map((node) => node.key);

    const fail = tryConnectWorkflowNodes(draft, first!, first!);
    expect(fail.ok).toBe(false);

    const ok = tryConnectWorkflowNodes(draft, first!, second!);
    expect(ok.ok).toBe(true);
    expect(ok.draft.definition.edges).toHaveLength(1);

    const dup = tryConnectWorkflowNodes(ok.draft, first!, second!);
    expect(dup.ok).toBe(false);

    const removed = tryDisconnectWorkflowEdge(ok.draft, first!, second!);
    expect(removed.ok).toBe(true);
    expect(removed.draft.definition.edges).toHaveLength(0);
  });
});
