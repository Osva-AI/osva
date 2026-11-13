import { describe, expect, it } from "vitest";

import type {
  ApprovalRequestId,
  WorkflowNodeRunId,
  WorkflowRunId,
  WorkspaceId,
} from "@osva-ai/contracts";

import { buildOfficeWorkflowApprovalViews } from "../src/office-execution-context-projection.js";

const ws = "ws-1" as WorkspaceId;

describe("buildOfficeWorkflowApprovalViews", () => {
  it("orders approvals by node sequence and attaches definition copy", () => {
    const nodeApprove = "nr-approve" as WorkflowNodeRunId;
    const views = buildOfficeWorkflowApprovalViews({
      workspaceId: ws,
      nodeRuns: [
        {
          id: "nr-first" as WorkflowNodeRunId,
          workspaceId: ws,
          workflowRunId: "wfr-1" as WorkflowRunId,
          workflowNodeKey: "first",
          sequence: 1,
          status: "SUCCEEDED",
          createdAt: new Date("2026-01-01T00:00:00.000Z"),
          updatedAt: new Date("2026-01-01T00:01:00.000Z"),
        },
        {
          id: nodeApprove,
          workspaceId: ws,
          workflowRunId: "wfr-1" as WorkflowRunId,
          workflowNodeKey: "approve",
          sequence: 2,
          status: "WAITING",
          createdAt: new Date("2026-01-01T00:01:00.000Z"),
          updatedAt: new Date("2026-01-01T00:01:00.000Z"),
        },
      ],
      approvalRequests: [
        {
          id: "apr-1" as ApprovalRequestId,
          workspaceId: ws,
          workflowRunId: "wfr-1" as WorkflowRunId,
          workflowNodeRunId: nodeApprove,
          status: "PENDING",
          createdAt: new Date("2026-01-01T00:01:00.000Z"),
        },
      ],
      workflowNodes: [
        { key: "first", type: "AGENT" },
        {
          key: "approve",
          type: "APPROVAL",
          title: "Review output",
          description: "Check for quality",
        },
      ],
    });

    expect(views).toHaveLength(1);
    expect(views[0]).toMatchObject({
      approvalRequestId: "apr-1",
      workflowNodeKey: "approve",
      approvalStatus: "PENDING",
      workflowNodeRunStatus: "WAITING",
      title: "Review output",
      description: "Check for quality",
    });
  });

  it("throws on workspace mismatch", () => {
    expect(() =>
      buildOfficeWorkflowApprovalViews({
        workspaceId: ws,
        nodeRuns: [],
        approvalRequests: [
          {
            id: "apr-1" as ApprovalRequestId,
            workspaceId: "ws-other" as WorkspaceId,
            workflowRunId: "wfr-1" as WorkflowRunId,
            workflowNodeRunId: "nr-1" as WorkflowNodeRunId,
            status: "PENDING",
            createdAt: new Date("2026-01-01T00:00:00.000Z"),
          },
        ],
      }),
    ).toThrow(/workspace/i);
  });
});
