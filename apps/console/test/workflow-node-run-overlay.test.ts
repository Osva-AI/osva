import { describe, expect, it } from "vitest";

import type { WorkflowNodeRunResource } from "../src/client/hooks/use-workflow-runs";
import {
  WORKFLOW_SUSPENDED_COPY,
  branchOutgoingStatuses,
  describeWorkflowSuspension,
  describeWorkflowWaitReason,
  edgeAppearanceById,
  executionStatusByNodeKey,
  joinPredecessorStatuses,
  nodeRunsForKey,
  parallelChildStatuses,
  selectLatestNodeRunByKey,
} from "../src/client/lib/workflow-node-run-overlay";
import type { WorkflowDefinitionView } from "../src/client/lib/workflow-definition";
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

  it("describes suspension without implying a live worker", () => {
    const reason = describeWorkflowSuspension(
      {
        key: "delay",
        type: "WAIT",
        wait: { kind: "DURATION", durationMs: 5000 },
      },
      nodeRun({
        id: "wn-wait",
        workflowNodeKey: "delay",
        status: "WAITING",
      }),
    );
    expect(reason).toMatch(/Waiting for a timer \(delay\)/);
    expect(reason).toContain(WORKFLOW_SUSPENDED_COPY);
  });

  it("styles BRANCH edges from persisted selectedTargetKey only", () => {
    const definition: WorkflowDefinitionView = {
      schemaVersion: "3",
      nodes: [
        { key: "route", type: "BRANCH", selector: "/x", defaultTo: "b" },
        { key: "a", type: "AGENT", agentVersionId: "av-1" },
        { key: "b", type: "AGENT", agentVersionId: "av-1" },
      ],
      edges: [
        { from: "route", to: "a" },
        { from: "route", to: "b" },
      ],
    };

    expect(edgeAppearanceById(definition, [])).toEqual({});
    expect(
      edgeAppearanceById(definition, [
        nodeRun({
          id: "wn-route",
          workflowNodeKey: "route",
          status: "SUCCEEDED",
        }),
      ]),
    ).toEqual({});

    const decided = edgeAppearanceById(definition, [
      nodeRun({
        id: "wn-route",
        workflowNodeKey: "route",
        status: "SUCCEEDED",
        selectedTargetKey: "a",
      }),
      nodeRun({
        id: "wn-b",
        workflowNodeKey: "b",
        status: "SKIPPED",
      }),
    ]);
    expect(decided["edge:route->a"]).toBe("selected");
    expect(decided["edge:route->b"]).toBe("skipped");
    expect(decided["edge:route->a"]).not.toBe("failed");
  });

  it("does not mark an unselected BRANCH path as FAILED", () => {
    const definition: WorkflowDefinitionView = {
      schemaVersion: "3",
      nodes: [
        { key: "route", type: "BRANCH", selector: "/x", defaultTo: "b" },
        { key: "a", type: "AGENT", agentVersionId: "av-1" },
        { key: "b", type: "AGENT", agentVersionId: "av-1" },
      ],
      edges: [
        { from: "route", to: "a" },
        { from: "route", to: "b" },
      ],
    };
    const appearances = edgeAppearanceById(definition, [
      nodeRun({
        id: "wn-route",
        workflowNodeKey: "route",
        status: "SUCCEEDED",
        selectedTargetKey: "a",
      }),
      nodeRun({
        id: "wn-a",
        workflowNodeKey: "a",
        status: "FAILED",
      }),
    ]);
    expect(appearances["edge:route->b"]).toBe("inactive");
    expect(Object.values(appearances)).not.toContain("failed");
  });

  it("lists PARALLEL children independently including partial completion", () => {
    const definition: WorkflowDefinitionView = {
      schemaVersion: "3",
      nodes: [
        { key: "fork", type: "PARALLEL" },
        { key: "left", type: "AGENT", agentVersionId: "av-1" },
        { key: "right", type: "AGENT", agentVersionId: "av-1" },
        { key: "join", type: "JOIN" },
      ],
      edges: [
        { from: "fork", to: "left" },
        { from: "fork", to: "right" },
        { from: "left", to: "join" },
        { from: "right", to: "join" },
      ],
    };
    const records = [
      nodeRun({
        id: "wn-left",
        workflowNodeKey: "left",
        status: "SUCCEEDED",
      }),
      nodeRun({
        id: "wn-right",
        workflowNodeKey: "right",
        status: "RUNNING",
      }),
    ];
    expect(parallelChildStatuses(definition, "fork", records)).toEqual([
      { key: "left", status: "SUCCEEDED" },
      { key: "right", status: "RUNNING" },
    ]);
  });

  it("lists JOIN predecessors without inventing failure for skipped paths", () => {
    const definition: WorkflowDefinitionView = {
      schemaVersion: "3",
      nodes: [
        { key: "left", type: "AGENT", agentVersionId: "av-1" },
        { key: "right", type: "AGENT", agentVersionId: "av-1" },
        { key: "join", type: "JOIN" },
      ],
      edges: [
        { from: "left", to: "join" },
        { from: "right", to: "join" },
      ],
    };
    expect(
      joinPredecessorStatuses(definition, "join", [
        nodeRun({
          id: "wn-left",
          workflowNodeKey: "left",
          status: "SKIPPED",
        }),
      ]),
    ).toEqual([
      { key: "left", status: "SKIPPED" },
      { key: "right", status: undefined },
    ]);
  });

  it("exposes BRANCH outgoing neighbors without inferring a missing decision", () => {
    const definition: WorkflowDefinitionView = {
      schemaVersion: "3",
      nodes: [
        { key: "route", type: "BRANCH", selector: "/x", defaultTo: "b" },
        { key: "a", type: "AGENT", agentVersionId: "av-1" },
        { key: "b", type: "AGENT", agentVersionId: "av-1" },
      ],
      edges: [
        { from: "route", to: "a" },
        { from: "route", to: "b" },
      ],
    };
    expect(branchOutgoingStatuses(definition, "route", [])).toEqual({
      selectedTargetKey: undefined,
      neighbors: [
        { key: "a", status: undefined },
        { key: "b", status: undefined },
      ],
    });
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
