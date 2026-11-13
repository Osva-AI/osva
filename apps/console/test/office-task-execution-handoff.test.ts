import { describe, expect, it } from "vitest";

import {
  buildOfficeAssignmentHandoffProjection,
  handoffEdgeKindToGraphAppearance,
} from "../src/client/lib/office-execution-context";
import type { WorkflowRunResource } from "../src/client/hooks/use-workflow-runs";

const workflowRun: WorkflowRunResource = {
  id: "wfr-1",
  workspaceId: "ws-1",
  workflowId: "wf-1",
  workflowVersionId: "wv-1",
  status: "RUNNING",
  input: {},
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:01:00.000Z",
  nodeRuns: [
    {
      id: "nr-1",
      workspaceId: "ws-1",
      workflowRunId: "wfr-1",
      workflowNodeKey: "a",
      sequence: 1,
      status: "SUCCEEDED",
      input: {},
      createdAt: "2026-01-01T00:01:00.000Z",
      updatedAt: "2026-01-01T00:01:10.000Z",
    },
    {
      id: "nr-2",
      workspaceId: "ws-1",
      workflowRunId: "wfr-1",
      workflowNodeKey: "b",
      sequence: 2,
      status: "RUNNING",
      input: {},
      createdAt: "2026-01-01T00:01:10.000Z",
      updatedAt: "2026-01-01T00:01:20.000Z",
    },
  ],
  approvalRequests: [],
};

describe("office task handoff adapter", () => {
  it("maps graph appearance from handoff edge kinds", () => {
    expect(handoffEdgeKindToGraphAppearance("EXECUTED_TRANSITION")).toBe(
      "selected",
    );
    expect(handoffEdgeKindToGraphAppearance("DEFINED_CONNECTION")).toBe(
      undefined,
    );
  });

  it("builds projection without network or mutation side effects", () => {
    const projection = buildOfficeAssignmentHandoffProjection({
      workspaceId: "ws-1",
      workflowDefinition: {
        schemaVersion: "3",
        nodes: [
          { key: "a", type: "AGENT", agentVersionId: "av-1" },
          { key: "b", type: "AGENT", agentVersionId: "av-2" },
        ],
        edges: [{ from: "a", to: "b" }],
      },
      workflowRun,
      workers: [],
    });

    expect(projection?.edges[0]?.kind).toBe("EXECUTED_TRANSITION");
    expect(projection?.executionStatusByNodeKey).toEqual({
      a: "SUCCEEDED",
      b: "RUNNING",
    });
  });
});
