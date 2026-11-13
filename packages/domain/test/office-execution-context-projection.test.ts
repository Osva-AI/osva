import type {
  AgentId,
  AgentVersionId,
  ApprovalRequestId,
  AssignmentId,
  OfficeWorkerId,
  RunId,
  WorkflowNodeRunId,
  WorkflowRunId,
  WorkspaceId,
} from "@osva-ai/contracts";
import { describe, expect, it } from "vitest";

import type { Assignment } from "../src/assignment.js";
import {
  buildAgentBackedExecutionContext,
  buildOfficeWorkerAssignmentHistory,
  buildWorkflowBackedExecutionContext,
  buildWorkflowExecutionTimeline,
  compareOfficeExecutionNodeRuns,
  indexOfficeWorkersByAgentId,
  resolveWorkflowNodeWorkerAttribution,
  sortOfficeExecutionNodeRuns,
} from "../src/office-execution-context-projection.js";

const wsA = "ws-a" as WorkspaceId;
const wsB = "ws-b" as WorkspaceId;

function assignmentRecord(
  partial: Partial<{
    id: AssignmentId;
    workspaceId: WorkspaceId;
    officeWorkerId: OfficeWorkerId;
    status: Assignment["status"];
    targetType: "AGENT_VERSION" | "WORKFLOW_VERSION";
    runId: RunId;
    workflowRunId: WorkflowRunId;
    goalId: string;
  }> & { readonly title?: string },
) {
  const now = new Date("2026-01-01T00:00:00.000Z");
  return {
    id: (partial.id ?? "asn-1") as AssignmentId,
    workspaceId: partial.workspaceId ?? wsA,
    officeWorkerId: (partial.officeWorkerId ?? "ow-1") as OfficeWorkerId,
    title: partial.title ?? "Task",
    status: partial.status ?? "RUNNING",
    targetType: partial.targetType ?? "AGENT_VERSION",
    targetVersionId: "target-v1",
    runId: partial.runId,
    workflowRunId: partial.workflowRunId,
    goalId: partial.goalId,
    createdAt: now,
    startedAt: new Date("2026-01-01T00:01:00.000Z"),
    completedAt: undefined,
    cancelledAt: undefined,
  };
}

describe("office execution context projection", () => {
  it("builds agent-backed execution context", () => {
    const runId = "run-1" as RunId;
    const context = buildAgentBackedExecutionContext({
      assignment: assignmentRecord({
        runId,
        status: "RUNNING",
      }),
      officeWorker: {
        id: "ow-1" as OfficeWorkerId,
        workspaceId: wsA,
        name: "Writer",
        agentId: "agent-1" as AgentId,
      },
      run: {
        id: runId,
        workspaceId: wsA,
        status: "RUNNING",
        createdAt: new Date("2026-01-01T00:01:00.000Z"),
        updatedAt: new Date("2026-01-01T00:02:00.000Z"),
      },
    });

    expect(context.kind).toBe("AGENT_RUN");
    expect(context.runId).toBe(runId);
    expect(context.runStatus).toBe("RUNNING");
  });

  it("orders workflow node runs by sequence then updatedAt", () => {
    const base = {
      workspaceId: wsA,
      workflowRunId: "wfr-1" as WorkflowRunId,
      workflowNodeKey: "step",
      status: "SUCCEEDED",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
    };
    const runs = sortOfficeExecutionNodeRuns([
      {
        ...base,
        id: "nr-2" as WorkflowNodeRunId,
        sequence: 2,
        updatedAt: new Date("2026-01-02T00:00:00.000Z"),
      },
      {
        ...base,
        id: "nr-1" as WorkflowNodeRunId,
        sequence: 1,
        updatedAt: new Date("2026-01-01T00:00:00.000Z"),
      },
    ]);

    expect(runs.map((row) => row.id)).toEqual(["nr-1", "nr-2"]);
    expect(compareOfficeExecutionNodeRuns(runs[0]!, runs[1]!)).toBeLessThan(0);
  });

  it("maps workflow timeline with approval, child run, and failure", () => {
    const agentVersionId = "av-1" as AgentVersionId;
    const agentId = "agent-1" as AgentId;
    const nodeRunId = "nr-approval" as WorkflowNodeRunId;

    const timeline = buildWorkflowExecutionTimeline({
      workspaceId: wsA,
      nodeRuns: [
        {
          id: "nr-agent" as WorkflowNodeRunId,
          workspaceId: wsA,
          workflowRunId: "wfr-1" as WorkflowRunId,
          workflowNodeKey: "agent-step",
          sequence: 1,
          status: "SUCCEEDED",
          childRunId: "child-run" as RunId,
          startedAt: new Date("2026-01-01T00:01:00.000Z"),
          completedAt: new Date("2026-01-01T00:02:00.000Z"),
          createdAt: new Date("2026-01-01T00:01:00.000Z"),
          updatedAt: new Date("2026-01-01T00:02:00.000Z"),
        },
        {
          id: nodeRunId,
          workspaceId: wsA,
          workflowRunId: "wfr-1" as WorkflowRunId,
          workflowNodeKey: "approve",
          sequence: 2,
          status: "WAITING",
          createdAt: new Date("2026-01-01T00:02:00.000Z"),
          updatedAt: new Date("2026-01-01T00:02:00.000Z"),
        },
        {
          id: "nr-fail" as WorkflowNodeRunId,
          workspaceId: wsA,
          workflowRunId: "wfr-1" as WorkflowRunId,
          workflowNodeKey: "cleanup",
          sequence: 3,
          status: "FAILED",
          createdAt: new Date("2026-01-01T00:03:00.000Z"),
          updatedAt: new Date("2026-01-01T00:03:00.000Z"),
        },
        {
          id: "nr-skip" as WorkflowNodeRunId,
          workspaceId: wsA,
          workflowRunId: "wfr-1" as WorkflowRunId,
          workflowNodeKey: "optional",
          sequence: 4,
          status: "SKIPPED",
          createdAt: new Date("2026-01-01T00:04:00.000Z"),
          updatedAt: new Date("2026-01-01T00:04:00.000Z"),
        },
      ],
      approvalRequests: [
        {
          id: "apr-1" as ApprovalRequestId,
          workspaceId: wsA,
          workflowRunId: "wfr-1" as WorkflowRunId,
          workflowNodeRunId: nodeRunId,
          status: "PENDING",
          createdAt: new Date("2026-01-01T00:02:00.000Z"),
        },
      ],
      workflowNodes: [
        {
          key: "agent-step",
          type: "AGENT",
          agentVersionId,
        },
        { key: "approve", type: "APPROVAL" },
        { key: "cleanup", type: "AGENT", agentVersionId },
        { key: "optional", type: "AGENT", agentVersionId },
      ],
      agentVersionsById: new Map([
        [agentVersionId, { id: agentVersionId, agentId }],
      ]),
      workersByAgentId: indexOfficeWorkersByAgentId([
        {
          id: "ow-1" as OfficeWorkerId,
          workspaceId: wsA,
          name: "Writer",
          agentId,
        },
      ]),
    });

    expect(timeline).toHaveLength(4);
    expect(timeline[0]?.childRunId).toBe("child-run");
    expect(timeline[1]?.approvalStatus).toBe("PENDING");
    expect(timeline[2]?.nodeStatus).toBe("FAILED");
    expect(timeline[3]?.nodeStatus).toBe("SKIPPED");
    expect(timeline[0]?.workerAttribution.kind).toBe("RESOLVED");
  });

  it("marks ambiguous office worker attribution", () => {
    const agentVersionId = "av-1" as AgentVersionId;
    const agentId = "agent-1" as AgentId;
    const attribution = resolveWorkflowNodeWorkerAttribution({
      workspaceId: wsA,
      agentVersionId,
      agentVersionsById: new Map([
        [agentVersionId, { id: agentVersionId, agentId }],
      ]),
      workersByAgentId: indexOfficeWorkersByAgentId([
        {
          id: "ow-1" as OfficeWorkerId,
          workspaceId: wsA,
          name: "A",
          agentId,
        },
        {
          id: "ow-2" as OfficeWorkerId,
          workspaceId: wsA,
          name: "B",
          agentId,
        },
      ]),
    });

    expect(attribution).toEqual({
      kind: "UNAVAILABLE",
      reason: "AMBIGUOUS_WORKERS",
      agentId,
      agentVersionId,
    });
  });

  it("builds workflow-backed execution context", () => {
    const workflowRunId = "wfr-1" as WorkflowRunId;
    const context = buildWorkflowBackedExecutionContext({
      assignment: assignmentRecord({
        targetType: "WORKFLOW_VERSION",
        workflowRunId,
        runId: undefined,
      }),
      officeWorker: {
        id: "ow-1" as OfficeWorkerId,
        workspaceId: wsA,
        name: "Writer",
        agentId: "agent-1" as AgentId,
      },
      workflowRun: {
        id: workflowRunId,
        workspaceId: wsA,
        workflowVersionId: "wv-1",
        status: "RUNNING",
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        updatedAt: new Date("2026-01-01T00:01:00.000Z"),
      },
      nodeRuns: [],
      approvalRequests: [],
      agentVersionsById: new Map(),
      workersByAgentId: new Map(),
    });

    expect(context.kind).toBe("WORKFLOW_RUN");
    expect(context.workflowRunId).toBe(workflowRunId);
    expect(context.timeline).toEqual([]);
  });

  it("filters worker assignment history and isolates workspaces", () => {
    const history = buildOfficeWorkerAssignmentHistory({
      workspaceId: wsA,
      officeWorkerId: "ow-1" as OfficeWorkerId,
      assignments: [
        {
          ...assignmentRecord({
            id: "asn-old" as AssignmentId,
            title: "Older",
            officeWorkerId: "ow-1" as OfficeWorkerId,
          }),
          createdAt: new Date("2026-01-01T00:00:00.000Z"),
        },
        {
          ...assignmentRecord({
            id: "asn-new" as AssignmentId,
            title: "Newer",
            officeWorkerId: "ow-1" as OfficeWorkerId,
            goalId: "goal-1",
          }),
          createdAt: new Date("2026-01-02T00:00:00.000Z"),
        },
        assignmentRecord({
          id: "asn-other" as AssignmentId,
          officeWorkerId: "ow-2" as OfficeWorkerId,
        }),
        assignmentRecord({
          id: "asn-cross" as AssignmentId,
          workspaceId: wsB,
          officeWorkerId: "ow-1" as OfficeWorkerId,
        }),
      ],
      limit: 10,
    });

    expect(history.map((row) => row.assignmentId)).toEqual([
      "asn-new",
      "asn-old",
    ]);
    expect(history[0]?.goalId).toBe("goal-1");
  });

  it("rejects cross-workspace workflow timeline inputs", () => {
    expect(() =>
      buildWorkflowExecutionTimeline({
        workspaceId: wsA,
        nodeRuns: [
          {
            id: "nr-1" as WorkflowNodeRunId,
            workspaceId: wsB,
            workflowRunId: "wfr-1" as WorkflowRunId,
            workflowNodeKey: "step",
            sequence: 1,
            status: "RUNNING",
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ],
        approvalRequests: [],
        agentVersionsById: new Map(),
        workersByAgentId: new Map(),
      }),
    ).toThrow(/workspace/);
  });
});
