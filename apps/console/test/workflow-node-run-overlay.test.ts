import { describe, expect, it } from "vitest";

import type { WorkflowNodeRunResource } from "../src/client/hooks/use-workflow-runs";
import {
  describeWorkflowWaitReason,
  executionStatusByNodeKey,
  nodeRunsForKey,
  selectLatestNodeRunByKey,
} from "../src/client/lib/workflow-node-run-overlay";
import { workflowRunRefetchInterval } from "../src/client/hooks/use-workflow-runs";
import { ACTIVE_RUN_POLL_MS } from "../src/client/lib/query-client";

function nodeRun(
  overrides: Partial<WorkflowNodeRunResource> &
    Pick<WorkflowNodeRunResource, "id" | "workflowNodeKey" | "status">,
): WorkflowNodeRunResource {
  return {
    workspaceId: "ws-1",
    workflowRunId: "wr-1",
    sequence: 1,
    input: {},
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("workflow node run overlay mapping", () => {
  it("maps only persisted workflowNodeKey records and omits missing nodes", () => {
    const statuses = executionStatusByNodeKey([
      nodeRun({
        id: "wn-1",
        workflowNodeKey: "agent",
        status: "RUNNING",
      }),
    ]);
    expect(statuses).toEqual({ agent: "RUNNING" });
    expect(statuses.approval).toBeUndefined();
  });

  it("uses the latest sequence when a node key has multiple records", () => {
    const records = [
      nodeRun({
        id: "wn-old",
        workflowNodeKey: "agent",
        sequence: 1,
        status: "FAILED",
        updatedAt: "2026-01-01T00:00:01.000Z",
      }),
      nodeRun({
        id: "wn-new",
        workflowNodeKey: "agent",
        sequence: 2,
        status: "RUNNING",
        updatedAt: "2026-01-01T00:00:02.000Z",
      }),
    ];

    expect(selectLatestNodeRunByKey(records).get("agent")?.id).toBe("wn-new");
    expect(executionStatusByNodeKey(records)).toEqual({ agent: "RUNNING" });
    expect(nodeRunsForKey(records, "agent").map((entry) => entry.id)).toEqual([
      "wn-old",
      "wn-new",
    ]);
  });

  it("does not mark a later failed record as succeeded because an earlier record succeeded", () => {
    const records = [
      nodeRun({
        id: "wn-1",
        workflowNodeKey: "agent",
        sequence: 1,
        status: "SUCCEEDED",
      }),
      nodeRun({
        id: "wn-2",
        workflowNodeKey: "agent",
        sequence: 3,
        status: "FAILED",
      }),
    ];
    expect(executionStatusByNodeKey(records)).toEqual({ agent: "FAILED" });
  });

  it("describes approval and event waits from actual records only", () => {
    expect(
      describeWorkflowWaitReason(
        { key: "approval", type: "APPROVAL", title: "Review" },
        nodeRun({
          id: "wn-2",
          workflowNodeKey: "approval",
          status: "WAITING",
        }),
      ),
    ).toMatch(/human approval/);
    expect(
      describeWorkflowWaitReason(
        {
          key: "wait-event",
          type: "WAIT",
          wait: {
            kind: "EVENT",
            source: "billing",
            eventType: "invoice.paid",
          },
        },
        nodeRun({
          id: "wn-3",
          workflowNodeKey: "wait-event",
          status: "WAITING",
        }),
      ),
    ).toMatch(/billing\/invoice\.paid/);
    expect(
      describeWorkflowWaitReason(
        { key: "approval", type: "APPROVAL" },
        nodeRun({
          id: "wn-2",
          workflowNodeKey: "approval",
          status: "SUCCEEDED",
        }),
      ),
    ).toBeUndefined();
  });

  it("polls only live workflow run statuses", () => {
    expect(workflowRunRefetchInterval("PENDING")).toBe(ACTIVE_RUN_POLL_MS);
    expect(workflowRunRefetchInterval("RUNNING")).toBe(ACTIVE_RUN_POLL_MS);
    expect(workflowRunRefetchInterval("WAITING")).toBe(ACTIVE_RUN_POLL_MS);
    expect(workflowRunRefetchInterval("SUCCEEDED")).toBe(false);
    expect(workflowRunRefetchInterval("FAILED")).toBe(false);
    expect(workflowRunRefetchInterval("CANCELLED")).toBe(false);
    expect(workflowRunRefetchInterval(undefined)).toBe(false);
  });
});
