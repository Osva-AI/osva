import { describe, expect, it } from "vitest";

import {
  findPrimaryWaitingNodeKey,
  inferDefaultSelectedNodeKey,
} from "../src/client/lib/workflow-run-detail-selection";

describe("workflow run detail selection", () => {
  it("prefers waiting approval nodes for default selection", () => {
    const definition = {
      schemaVersion: "3",
      nodes: [
        { key: "agent", type: "AGENT", agentVersionId: "av-1" },
        { key: "approval", type: "APPROVAL", title: "Review" },
      ],
      edges: [{ from: "agent", to: "approval" }],
    };
    const key = inferDefaultSelectedNodeKey({
      runStatus: "WAITING",
      definition,
      nodeRuns: [
        {
          id: "wn-1",
          workspaceId: "ws-1",
          workflowRunId: "wr-1",
          workflowNodeKey: "agent",
          sequence: 1,
          status: "SUCCEEDED",
          input: {},
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:01.000Z",
        },
        {
          id: "wn-2",
          workspaceId: "ws-1",
          workflowRunId: "wr-1",
          workflowNodeKey: "approval",
          sequence: 2,
          status: "WAITING",
          input: {},
          createdAt: "2026-01-01T00:00:01.000Z",
          updatedAt: "2026-01-01T00:00:02.000Z",
        },
      ],
    });
    expect(key).toBe("approval");
    expect(
      findPrimaryWaitingNodeKey({
        definition,
        nodeRuns: [
          {
            id: "wn-2",
            workspaceId: "ws-1",
            workflowRunId: "wr-1",
            workflowNodeKey: "approval",
            sequence: 2,
            status: "WAITING",
            input: {},
            createdAt: "2026-01-01T00:00:01.000Z",
            updatedAt: "2026-01-01T00:00:02.000Z",
          },
        ],
      }),
    ).toBe("approval");
  });
});
