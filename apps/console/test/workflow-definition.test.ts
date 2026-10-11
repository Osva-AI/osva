import { describe, expect, it } from "vitest";

import {
  incomingNodeKeys,
  orderWorkflowNodeKeys,
  outgoingNodeKeys,
  resolveJsonPointerValue,
  workflowEdgeId,
} from "../src/client/lib/workflow-definition";

describe("workflow definition helpers", () => {
  it("orders nodes by DAG edges", () => {
    const ordered = orderWorkflowNodeKeys({
      schemaVersion: "2",
      nodes: [
        { key: "c", type: "JOIN" },
        { key: "a", type: "AGENT", agentVersionId: "av-1" },
        { key: "b", type: "AGENT", agentVersionId: "av-1" },
      ],
      edges: [
        { from: "a", to: "b" },
        { from: "b", to: "c" },
      ],
    });
    expect(ordered).toEqual(["a", "b", "c"]);
  });

  it("resolves input pointer values", () => {
    expect(resolveJsonPointerValue("/invoiceId", { invoiceId: "inv-1" })).toBe(
      "inv-1",
    );
  });

  it("lists incoming and outgoing neighbors without inventing edges", () => {
    const definition = {
      schemaVersion: "3",
      nodes: [
        { key: "fork", type: "PARALLEL" },
        { key: "left", type: "AGENT", agentVersionId: "av-1" },
        { key: "right", type: "AGENT", agentVersionId: "av-1" },
      ],
      edges: [
        { from: "fork", to: "left" },
        { from: "fork", to: "right" },
      ],
    };
    expect(outgoingNodeKeys(definition, "fork")).toEqual(["left", "right"]);
    expect(incomingNodeKeys(definition, "left")).toEqual(["fork"]);
    expect(workflowEdgeId("fork", "left")).toBe("edge:fork->left");
  });
});
