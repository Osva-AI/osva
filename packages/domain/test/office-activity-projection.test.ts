import type {
  AgentId,
  AgentVersionId,
  ApprovalRequestId,
  ArtifactId,
  AssignmentId,
  GoalId,
  OfficeWorkerId,
  RunId,
  WorkflowNodeRunId,
  WorkflowRunId,
  WorkspaceId,
} from "@osva-ai/contracts";
import { describe, expect, it } from "vitest";

import {
  buildOfficeActivitiesForAssignments,
  buildOfficeApprovalActivities,
  buildOfficeArtifactActivities,
  buildOfficeAssignmentLifecycleActivities,
  buildOfficeTaskDetailActivityTimeline,
  buildOfficeWorkflowNodeActivities,
  compareOfficeActivityEntries,
  filterOfficeActivities,
  mergeOfficeActivityEntries,
  paginateOfficeActivitiesBounded,
  type OfficeActivityWorkflowSnapshot,
} from "../src/office-activity-projection.js";
import type { OfficeExecutionAssignmentRecord } from "../src/office-execution-context-projection.js";

const ws = "ws-1" as WorkspaceId;
const worker = "ow-1" as OfficeWorkerId;
const goal = "goal-1" as GoalId;

function assignment(
  partial: Partial<OfficeExecutionAssignmentRecord> & {
    readonly id: AssignmentId;
  },
): OfficeExecutionAssignmentRecord {
  const base: OfficeExecutionAssignmentRecord = {
    id: partial.id,
    workspaceId: partial.workspaceId ?? ws,
    officeWorkerId: partial.officeWorkerId ?? worker,
    title: partial.title ?? "Task",
    status: partial.status ?? "PENDING",
    targetType: partial.targetType ?? "AGENT_VERSION",
    targetVersionId: "target-v1",
    runId: partial.runId,
    workflowRunId: partial.workflowRunId,
    goalId: partial.goalId ?? goal,
    createdAt: partial.createdAt ?? new Date("2026-01-01T00:00:00.000Z"),
    startedAt: partial.startedAt,
    completedAt: partial.completedAt,
    cancelledAt: partial.cancelledAt,
  };
  return base;
}

describe("office activity projection", () => {
  it("emits task creation and start timestamps", () => {
    const rows = buildOfficeAssignmentLifecycleActivities(
      assignment({
        id: "asn-1" as AssignmentId,
        status: "RUNNING",
        startedAt: new Date("2026-01-01T00:01:00.000Z"),
      }),
    );
    expect(rows.map((row) => row.activityType)).toEqual([
      "TASK_CREATED",
      "TASK_STARTED",
    ]);
  });

  it("emits task completion and failure timestamps", () => {
    const completed = buildOfficeAssignmentLifecycleActivities(
      assignment({
        id: "asn-done" as AssignmentId,
        status: "COMPLETED",
        completedAt: new Date("2026-01-02T00:00:00.000Z"),
      }),
    );
    expect(completed.some((row) => row.activityType === "TASK_COMPLETED")).toBe(
      true,
    );

    const failed = buildOfficeAssignmentLifecycleActivities(
      assignment({
        id: "asn-fail" as AssignmentId,
        status: "FAILED",
        workflowRunId: "wfr-1" as WorkflowRunId,
      }),
      {
        workflowRun: {
          id: "wfr-1" as WorkflowRunId,
          workspaceId: ws,
          workflowVersionId: "wv-1",
          status: "FAILED",
          createdAt: new Date("2026-01-01T00:00:00.000Z"),
          completedAt: new Date("2026-01-01T01:00:00.000Z"),
          updatedAt: new Date("2026-01-01T01:00:00.000Z"),
        },
      },
    );
    const failRow = failed.find((row) => row.activityType === "TASK_FAILED");
    expect(failRow?.occurredAt).toBe("2026-01-01T01:00:00.000Z");
  });

  it("emits cancelled task activity", () => {
    const rows = buildOfficeAssignmentLifecycleActivities(
      assignment({
        id: "asn-cancel" as AssignmentId,
        status: "CANCELLED",
        cancelledAt: new Date("2026-01-03T00:00:00.000Z"),
      }),
    );
    expect(rows.some((row) => row.activityType === "TASK_CANCELLED")).toBe(
      true,
    );
  });

  it("projects workflow node execution and skipped branch", () => {
    const asn = assignment({
      id: "asn-wf" as AssignmentId,
      targetType: "WORKFLOW_VERSION",
      workflowRunId: "wfr-1" as WorkflowRunId,
      status: "RUNNING",
    });
    const agentVersions = new Map([
      [
        "av-1" as AgentVersionId,
        { id: "av-1" as AgentVersionId, agentId: "agent-1" as AgentId },
      ],
    ]);
    const workersByAgent = new Map([
      [
        "agent-1" as AgentId,
        [
          {
            id: worker,
            workspaceId: ws,
            name: "Writer",
            agentId: "agent-1" as AgentId,
          },
        ],
      ],
    ]);
    const rows = buildOfficeWorkflowNodeActivities({
      workspaceId: ws,
      assignment: asn,
      workflowRun: {
        id: "wfr-1" as WorkflowRunId,
        workspaceId: ws,
        workflowVersionId: "wv-1",
        status: "RUNNING",
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        updatedAt: new Date("2026-01-01T00:00:00.000Z"),
      },
      nodeRuns: [
        {
          id: "nr-1" as WorkflowNodeRunId,
          workspaceId: ws,
          workflowRunId: "wfr-1" as WorkflowRunId,
          workflowNodeKey: "agent",
          sequence: 1,
          status: "SUCCEEDED",
          startedAt: new Date("2026-01-01T00:10:00.000Z"),
          completedAt: new Date("2026-01-01T00:20:00.000Z"),
          createdAt: new Date("2026-01-01T00:00:00.000Z"),
          updatedAt: new Date("2026-01-01T00:20:00.000Z"),
        },
        {
          id: "nr-2" as WorkflowNodeRunId,
          workspaceId: ws,
          workflowRunId: "wfr-1" as WorkflowRunId,
          workflowNodeKey: "branch-skip",
          sequence: 2,
          status: "SKIPPED",
          completedAt: new Date("2026-01-01T00:21:00.000Z"),
          createdAt: new Date("2026-01-01T00:00:00.000Z"),
          updatedAt: new Date("2026-01-01T00:21:00.000Z"),
        },
      ],
      workflowNodes: [
        {
          key: "agent",
          type: "AGENT",
          agentVersionId: "av-1" as AgentVersionId,
        },
        { key: "branch-skip", type: "AGENT" },
      ],
      agentVersionsById: agentVersions,
      workersByAgentId: workersByAgent,
    });
    expect(rows.map((row) => row.activityType)).toContain(
      "WORKFLOW_NODE_STARTED",
    );
    expect(rows.map((row) => row.activityType)).toContain(
      "WORKFLOW_NODE_SKIPPED",
    );
  });

  it("projects approval requested and decided", () => {
    const asn = assignment({
      id: "asn-appr" as AssignmentId,
      workflowRunId: "wfr-1" as WorkflowRunId,
    });
    const rows = buildOfficeApprovalActivities({
      workspaceId: ws,
      assignment: asn,
      approvalRequests: [
        {
          id: "appr-1" as ApprovalRequestId,
          workspaceId: ws,
          workflowRunId: "wfr-1" as WorkflowRunId,
          workflowNodeRunId: "nr-appr" as WorkflowNodeRunId,
          status: "REJECTED",
          createdAt: new Date("2026-01-01T00:30:00.000Z"),
          decidedAt: new Date("2026-01-01T00:45:00.000Z"),
        },
      ],
    });
    expect(rows.map((row) => row.activityType)).toEqual([
      "APPROVAL_REQUESTED",
      "APPROVAL_REJECTED",
    ]);
  });

  it("creates artifact activity only with verified task provenance", () => {
    const artifacts = buildOfficeArtifactActivities({
      artifacts: [
        {
          id: "art-1" as ArtifactId,
          workspaceId: ws,
          name: "out.txt",
          createdAt: "2026-01-02T00:00:00.000Z",
          producerRunId: "run-1" as RunId,
        },
      ],
      assignments: [
        {
          id: "asn-1" as AssignmentId,
          officeWorkerId: worker,
          targetType: "AGENT_VERSION",
          runId: "run-1" as RunId,
          goalId: goal,
        },
      ],
      workflowChildBindings: [],
    });
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0]?.activityType).toBe("ARTIFACT_CREATED");

    const none = buildOfficeArtifactActivities({
      artifacts: [
        {
          id: "art-orphan" as ArtifactId,
          workspaceId: ws,
          name: "orphan.txt",
          createdAt: "2026-01-02T00:00:00.000Z",
          producerRunId: "run-x" as RunId,
        },
      ],
      assignments: [],
      workflowChildBindings: [],
    });
    expect(none).toHaveLength(0);
  });

  it("marks ambiguous workers without fabricating attribution", () => {
    const asn = assignment({
      id: "asn-ambig" as AssignmentId,
      workflowRunId: "wfr-1" as WorkflowRunId,
    });
    const rows = buildOfficeWorkflowNodeActivities({
      workspaceId: ws,
      assignment: asn,
      workflowRun: {
        id: "wfr-1" as WorkflowRunId,
        workspaceId: ws,
        workflowVersionId: "wv-1",
        status: "RUNNING",
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        updatedAt: new Date("2026-01-01T00:00:00.000Z"),
      },
      nodeRuns: [
        {
          id: "nr-1" as WorkflowNodeRunId,
          workspaceId: ws,
          workflowRunId: "wfr-1" as WorkflowRunId,
          workflowNodeKey: "agent",
          sequence: 1,
          status: "RUNNING",
          startedAt: new Date("2026-01-01T00:05:00.000Z"),
          createdAt: new Date("2026-01-01T00:00:00.000Z"),
          updatedAt: new Date("2026-01-01T00:05:00.000Z"),
        },
      ],
      workflowNodes: [
        {
          key: "agent",
          type: "AGENT",
          agentVersionId: "av-1" as AgentVersionId,
        },
      ],
      agentVersionsById: new Map([
        [
          "av-1" as AgentVersionId,
          { id: "av-1" as AgentVersionId, agentId: "agent-1" as AgentId },
        ],
      ]),
      workersByAgentId: new Map([
        [
          "agent-1" as AgentId,
          [
            {
              id: "ow-a" as OfficeWorkerId,
              workspaceId: ws,
              name: "A",
              agentId: "agent-1" as AgentId,
            },
            {
              id: "ow-b" as OfficeWorkerId,
              workspaceId: ws,
              name: "B",
              agentId: "agent-1" as AgentId,
            },
          ],
        ],
      ]),
    });
    expect(rows[0]?.officeWorkerId).toBe(worker);
  });

  it("deduplicates activity ids and orders equal timestamps deterministically", () => {
    const first = {
      id: "a-1",
      workspaceId: ws,
      activityType: "TASK_CREATED" as const,
      occurredAt: "2026-01-01T00:00:00.000Z",
      sourceKind: "assignment" as const,
      sourceId: "asn-1",
      navigation: {
        kind: "task" as const,
        href: "/office/tasks/asn-1",
        resourceId: "asn-1",
      },
    };
    const second = {
      ...first,
      id: "a-2",
      activityType: "TASK_STARTED" as const,
    };
    const merged = mergeOfficeActivityEntries([[first, first], [second]]);
    expect(merged).toHaveLength(2);
    expect(compareOfficeActivityEntries(first, second)).toBeLessThan(0);
  });

  it("handles missing task failure timestamps", () => {
    const rows = buildOfficeAssignmentLifecycleActivities(
      assignment({
        id: "asn-no-ts" as AssignmentId,
        status: "FAILED",
        runId: "run-1" as RunId,
      }),
    );
    const failed = rows.find((row) => row.activityType === "TASK_FAILED");
    expect(failed).toBeDefined();
    expect(failed?.occurredAt).toBeUndefined();
  });

  it("filters by date range and workspace scope", () => {
    const entries = [
      {
        id: "e-1",
        workspaceId: ws,
        activityType: "TASK_CREATED" as const,
        occurredAt: "2026-01-01T00:00:00.000Z",
        sourceKind: "assignment" as const,
        sourceId: "asn-1",
        assignmentId: "asn-1" as AssignmentId,
        navigation: {
          kind: "task" as const,
          href: "/office/tasks/asn-1",
          resourceId: "asn-1",
        },
      },
      {
        id: "e-2",
        workspaceId: ws,
        activityType: "TASK_CREATED" as const,
        occurredAt: "2026-02-01T00:00:00.000Z",
        sourceKind: "assignment" as const,
        sourceId: "asn-2",
        assignmentId: "asn-2" as AssignmentId,
        navigation: {
          kind: "task" as const,
          href: "/office/tasks/asn-2",
          resourceId: "asn-2",
        },
      },
    ];
    const filtered = filterOfficeActivities(entries, {
      occurredAfter: "2026-01-15T00:00:00.000Z",
    });
    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.id).toBe("e-2");
  });

  it("bounds pagination with completeness flag", () => {
    const entries = Array.from({ length: 5 }, (_, index) => ({
      id: `e-${index}`,
      workspaceId: ws,
      activityType: "TASK_CREATED" as const,
      occurredAt: `2026-01-0${index + 1}T00:00:00.000Z`,
      sourceKind: "assignment" as const,
      sourceId: `asn-${index}`,
      navigation: {
        kind: "task" as const,
        href: `/office/tasks/asn-${index}`,
        resourceId: `asn-${index}`,
      },
    }));
    const page = paginateOfficeActivitiesBounded(entries, 3);
    expect(page.items).toHaveLength(3);
    expect(page.truncated).toBe(true);
  });

  it("throws on workspace mismatch for workflow node projection", () => {
    expect(() =>
      buildOfficeWorkflowNodeActivities({
        workspaceId: ws,
        assignment: assignment({
          id: "asn-bad" as AssignmentId,
          workflowRunId: "wfr-1" as WorkflowRunId,
        }),
        workflowRun: {
          id: "wfr-1" as WorkflowRunId,
          workspaceId: "ws-other" as WorkspaceId,
          workflowVersionId: "wv-1",
          status: "RUNNING",
          createdAt: new Date("2026-01-01T00:00:00.000Z"),
          updatedAt: new Date("2026-01-01T00:00:00.000Z"),
        },
        nodeRuns: [],
        agentVersionsById: new Map(),
        workersByAgentId: new Map(),
      }),
    ).toThrow(/workspace/);
  });

  it("builds integrated assignment feed without duplicate assignment/workflow-run creation", () => {
    const snapshot: OfficeActivityWorkflowSnapshot = {
      workflowRun: {
        id: "wfr-1" as WorkflowRunId,
        workspaceId: ws,
        workflowVersionId: "wv-1",
        status: "RUNNING",
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        updatedAt: new Date("2026-01-01T00:00:00.000Z"),
      },
      nodeRuns: [],
      approvalRequests: [],
    };
    const rows = buildOfficeActivitiesForAssignments({
      workspaceId: ws,
      assignments: [
        assignment({
          id: "asn-int" as AssignmentId,
          workflowRunId: "wfr-1" as WorkflowRunId,
        }),
      ],
      workflowSnapshotsByRunId: new Map([["wfr-1" as WorkflowRunId, snapshot]]),
      agentVersionsById: new Map(),
      workersByAgentId: new Map(),
    });
    const ids = new Set(rows.map((row) => row.id));
    expect(ids.size).toBe(rows.length);
  });

  it("builds task detail timeline merging lifecycle and workflow rows", () => {
    const rows = buildOfficeTaskDetailActivityTimeline({
      workspaceId: ws,
      assignment: assignment({
        id: "asn-detail" as AssignmentId,
        workflowRunId: "wfr-1" as WorkflowRunId,
        startedAt: new Date("2026-01-01T00:01:00.000Z"),
      }),
      workflowSnapshot: {
        workflowRun: {
          id: "wfr-1" as WorkflowRunId,
          workspaceId: ws,
          workflowVersionId: "wv-1",
          status: "RUNNING",
          createdAt: new Date("2026-01-01T00:00:00.000Z"),
          updatedAt: new Date("2026-01-01T00:00:00.000Z"),
        },
        nodeRuns: [],
        approvalRequests: [],
      },
      artifacts: [],
      deliverableAssignments: [],
      workflowChildBindings: [],
      agentVersionsById: new Map(),
      workersByAgentId: new Map(),
    });
    expect(rows.length).toBeGreaterThanOrEqual(2);
  });
});
