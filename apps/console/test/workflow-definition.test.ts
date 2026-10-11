import { describe, expect, it } from "vitest";

import {
  orderWorkflowNodeKeys,
  resolveJsonPointerValue,
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
});
