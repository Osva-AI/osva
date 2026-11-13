import type {
  AgentId,
  AgentVersionId,
  ApprovalRequestId,
  OfficeWorkerId,
  RunId,
  WorkflowNodeRunId,
  WorkflowRunId,
  WorkspaceId,
} from "@osva-ai/contracts";
import { describe, expect, it } from "vitest";

import {
  buildOfficeWorkflowHandoffProjection,
  indexTeamMembershipsByWorkerId,
  resolveOfficeWorkerTeamContext,
  resolveWorkflowHandoffEdgeKind,
  workflowHandoffEdgeId,
} from "../src/office-workflow-handoff-projection.js";
import { indexOfficeWorkersByAgentId } from "../src/office-execution-context-projection.js";

const ws = "ws-1" as WorkspaceId;
const wfr = "wfr-1" as WorkflowRunId;
const av1 = "av-1" as AgentVersionId;
const av2 = "av-2" as AgentVersionId;
const agentA = "agent-a" as AgentId;
const agentB = "agent-b" as AgentId;
const ow1 = "ow-1" as OfficeWorkerId;
const ow2 = "ow-2" as OfficeWorkerId;

function nodeRun(partial: {
  readonly id: WorkflowNodeRunId;
  readonly workflowNodeKey: string;
  readonly sequence: number;
  readonly status: string;
  readonly childRunId?: RunId;
  readonly selectedTargetKey?: string;
}) {
  const now = new Date("2026-01-01T00:00:00.000Z");
  return {
    id: partial.id,
    workspaceId: ws,
    workflowRunId: wfr,
    workflowNodeKey: partial.workflowNodeKey,
    sequence: partial.sequence,
    status: partial.status,
    childRunId: partial.childRunId,
    selectedTargetKey: partial.selectedTargetKey,
    createdAt: now,
    updatedAt: now,
  };
}

const agentVersions = new Map([
  [av1, { id: av1, agentId: agentA }],
  [av2, { id: av2, agentId: agentB }],
]);

describe("office workflow handoff projection", () => {
  it("marks sequential A→B executed only with persistence evidence", () => {
    const projection = buildOfficeWorkflowHandoffProjection({
      workspaceId: ws,
      workflowNodes: [
        { key: "a", type: "AGENT", agentVersionId: av1 },
        { key: "b", type: "AGENT", agentVersionId: av2 },
      ],
      workflowEdges: [{ from: "a", to: "b" }],
      nodeRuns: [
        nodeRun({
          id: "nr-a" as WorkflowNodeRunId,
          workflowNodeKey: "a",
          sequence: 1,
          status: "SUCCEEDED",
        }),
      ],
      approvalRequests: [],
      agentVersionsById: agentVersions,
      workersByAgentId: indexOfficeWorkersByAgentId([
        { id: ow1, workspaceId: ws, name: "Worker A", agentId: agentA },
        { id: ow2, workspaceId: ws, name: "Worker B", agentId: agentB },
      ]),
    });

    const edge = projection.edges[0]!;
    expect(edge.kind).toBe("DEFINED_CONNECTION");

    const executed = buildOfficeWorkflowHandoffProjection({
      workspaceId: ws,
      workflowNodes: [
        { key: "a", type: "AGENT", agentVersionId: av1 },
        { key: "b", type: "AGENT", agentVersionId: av2 },
      ],
      workflowEdges: [{ from: "a", to: "b" }],
      nodeRuns: [
        nodeRun({
          id: "nr-a" as WorkflowNodeRunId,
          workflowNodeKey: "a",
          sequence: 1,
          status: "SUCCEEDED",
        }),
        nodeRun({
          id: "nr-b" as WorkflowNodeRunId,
          workflowNodeKey: "b",
          sequence: 2,
          status: "RUNNING",
        }),
      ],
      approvalRequests: [],
      agentVersionsById: agentVersions,
      workersByAgentId: new Map(),
    });
    expect(executed.edges[0]?.kind).toBe("EXECUTED_TRANSITION");
  });

  it("models approval wait between agents", () => {
    const approvalNode = "nr-apr" as WorkflowNodeRunId;
    const projection = buildOfficeWorkflowHandoffProjection({
      workspaceId: ws,
      workflowNodes: [
        { key: "a", type: "AGENT", agentVersionId: av1 },
        { key: "apr", type: "APPROVAL" },
        { key: "b", type: "AGENT", agentVersionId: av2 },
      ],
      workflowEdges: [
        { from: "a", to: "apr" },
        { from: "apr", to: "b" },
      ],
      nodeRuns: [
        nodeRun({
          id: "nr-a" as WorkflowNodeRunId,
          workflowNodeKey: "a",
          sequence: 1,
          status: "SUCCEEDED",
        }),
        nodeRun({
          id: approvalNode,
          workflowNodeKey: "apr",
          sequence: 2,
          status: "WAITING",
        }),
      ],
      approvalRequests: [
        {
          id: "apr-1" as ApprovalRequestId,
          workspaceId: ws,
          workflowRunId: wfr,
          workflowNodeRunId: approvalNode,
          status: "PENDING",
          createdAt: new Date(),
        },
      ],
      agentVersionsById: agentVersions,
      workersByAgentId: new Map(),
    });

    const aprNode = projection.nodes.find((n) => n.workflowNodeKey === "apr");
    expect(aprNode?.stepKind).toBe("WAITING_FOR_APPROVAL");
    expect(projection.blockingNodeKey).toBe("apr");
    expect(
      projection.edges.find(
        (edge) => edge.id === workflowHandoffEdgeId("a", "apr"),
      )?.kind,
    ).toBe("EXECUTED_TRANSITION");
    expect(
      projection.edges.find(
        (edge) => edge.id === workflowHandoffEdgeId("apr", "b"),
      )?.kind,
    ).toBe("DEFINED_CONNECTION");
  });

  it("handles rejected approval without inventing downstream execution", () => {
    const projection = buildOfficeWorkflowHandoffProjection({
      workspaceId: ws,
      workflowNodes: [
        { key: "apr", type: "APPROVAL" },
        { key: "b", type: "AGENT", agentVersionId: av2 },
      ],
      workflowEdges: [{ from: "apr", to: "b" }],
      nodeRuns: [
        nodeRun({
          id: "nr-apr" as WorkflowNodeRunId,
          workflowNodeKey: "apr",
          sequence: 1,
          status: "FAILED",
        }),
      ],
      approvalRequests: [
        {
          id: "apr-1" as ApprovalRequestId,
          workspaceId: ws,
          workflowRunId: wfr,
          workflowNodeRunId: "nr-apr" as WorkflowNodeRunId,
          status: "REJECTED",
          createdAt: new Date(),
        },
      ],
      agentVersionsById: agentVersions,
      workersByAgentId: new Map(),
    });

    expect(
      projection.edges.find(
        (edge) => edge.id === workflowHandoffEdgeId("apr", "b"),
      )?.kind,
    ).toBe("FAILED_DOWNSTREAM");
  });

  it("honors branch selection and skipped targets", () => {
    const kind = resolveWorkflowHandoffEdgeKind({
      fromKey: "route",
      toKey: "b",
      sourceType: "BRANCH",
      sourceRun: nodeRun({
        id: "nr-route" as WorkflowNodeRunId,
        workflowNodeKey: "route",
        sequence: 1,
        status: "SUCCEEDED",
        selectedTargetKey: "a",
      }),
      targetRun: nodeRun({
        id: "nr-b" as WorkflowNodeRunId,
        workflowNodeKey: "b",
        sequence: 3,
        status: "SKIPPED",
      }),
    });
    expect(kind).toBe("SKIPPED_PATH");
  });

  it("exposes parallel child execution states", () => {
    const projection = buildOfficeWorkflowHandoffProjection({
      workspaceId: ws,
      workflowNodes: [
        { key: "par", type: "PARALLEL" },
        { key: "left", type: "AGENT", agentVersionId: av1 },
        { key: "right", type: "AGENT", agentVersionId: av2 },
        { key: "join", type: "JOIN" },
      ],
      workflowEdges: [
        { from: "par", to: "left" },
        { from: "par", to: "right" },
        { from: "left", to: "join" },
        { from: "right", to: "join" },
      ],
      nodeRuns: [
        nodeRun({
          id: "nr-par" as WorkflowNodeRunId,
          workflowNodeKey: "par",
          sequence: 1,
          status: "SUCCEEDED",
        }),
        nodeRun({
          id: "nr-left" as WorkflowNodeRunId,
          workflowNodeKey: "left",
          sequence: 2,
          status: "SUCCEEDED",
        }),
        nodeRun({
          id: "nr-right" as WorkflowNodeRunId,
          workflowNodeKey: "right",
          sequence: 3,
          status: "RUNNING",
        }),
      ],
      approvalRequests: [],
      agentVersionsById: agentVersions,
      workersByAgentId: new Map(),
    });

    expect(
      projection.edges.find(
        (edge) => edge.id === workflowHandoffEdgeId("par", "left"),
      )?.kind,
    ).toBe("EXECUTED_TRANSITION");
    expect(
      projection.edges.find(
        (edge) => edge.id === workflowHandoffEdgeId("par", "right"),
      )?.kind,
    ).toBe("EXECUTED_TRANSITION");
    expect(
      projection.edges.find(
        (edge) => edge.id === workflowHandoffEdgeId("left", "join"),
      )?.kind,
    ).toBe("DEFINED_CONNECTION");
  });

  it("links child runs without mutating projection inputs", () => {
    const child = "child-1" as RunId;
    const projection = buildOfficeWorkflowHandoffProjection({
      workspaceId: ws,
      workflowNodes: [{ key: "a", type: "AGENT", agentVersionId: av1 }],
      workflowEdges: [],
      nodeRuns: [
        nodeRun({
          id: "nr-a" as WorkflowNodeRunId,
          workflowNodeKey: "a",
          sequence: 1,
          status: "SUCCEEDED",
          childRunId: child,
        }),
      ],
      approvalRequests: [],
      agentVersionsById: agentVersions,
      workersByAgentId: indexOfficeWorkersByAgentId([
        { id: ow1, workspaceId: ws, name: "Worker A", agentId: agentA },
      ]),
    });

    expect(projection.nodes[0]?.childRunId).toBe(child);
  });

  it("resolves one office worker attribution", () => {
    const projection = buildOfficeWorkflowHandoffProjection({
      workspaceId: ws,
      workflowNodes: [{ key: "a", type: "AGENT", agentVersionId: av1 }],
      workflowEdges: [],
      nodeRuns: [
        nodeRun({
          id: "nr-a" as WorkflowNodeRunId,
          workflowNodeKey: "a",
          sequence: 1,
          status: "SUCCEEDED",
        }),
      ],
      approvalRequests: [],
      agentVersionsById: agentVersions,
      workersByAgentId: indexOfficeWorkersByAgentId([
        { id: ow1, workspaceId: ws, name: "Only", agentId: agentA },
      ]),
    });
    expect(projection.nodes[0]?.workerAttribution).toEqual({
      kind: "RESOLVED",
      officeWorkerId: ow1,
      officeWorkerName: "Only",
    });
  });

  it("surfaces ambiguous workers", () => {
    const projection = buildOfficeWorkflowHandoffProjection({
      workspaceId: ws,
      workflowNodes: [{ key: "a", type: "AGENT", agentVersionId: av1 }],
      workflowEdges: [],
      nodeRuns: [
        nodeRun({
          id: "nr-a" as WorkflowNodeRunId,
          workflowNodeKey: "a",
          sequence: 1,
          status: "SUCCEEDED",
        }),
      ],
      approvalRequests: [],
      agentVersionsById: agentVersions,
      workersByAgentId: indexOfficeWorkersByAgentId([
        { id: ow1, workspaceId: ws, name: "A", agentId: agentA },
        { id: ow2, workspaceId: ws, name: "B", agentId: agentA },
      ]),
    });
    expect(projection.nodes[0]?.workerAttribution).toMatchObject({
      kind: "UNAVAILABLE",
      reason: "AMBIGUOUS_WORKERS",
    });
  });

  it("shows no worker when agent has none registered", () => {
    const projection = buildOfficeWorkflowHandoffProjection({
      workspaceId: ws,
      workflowNodes: [{ key: "a", type: "AGENT", agentVersionId: av1 }],
      workflowEdges: [],
      nodeRuns: [
        nodeRun({
          id: "nr-a" as WorkflowNodeRunId,
          workflowNodeKey: "a",
          sequence: 1,
          status: "SUCCEEDED",
        }),
      ],
      approvalRequests: [],
      agentVersionsById: agentVersions,
      workersByAgentId: new Map(),
    });
    expect(projection.nodes[0]?.workerAttribution).toMatchObject({
      kind: "UNAVAILABLE",
      reason: "NO_REGISTERED_WORKER",
    });
  });

  it("attaches team associations without implying ownership", () => {
    const memberships = indexTeamMembershipsByWorkerId([
      { teamId: "team-1", officeWorkerId: ow1, roleId: "role-1" },
    ]);
    const teamContext = resolveOfficeWorkerTeamContext({
      workspaceId: ws,
      officeWorkerId: ow1,
      teamsById: new Map([
        ["team-1", { id: "team-1", workspaceId: ws, name: "Ops" }],
      ]),
      rolesById: new Map([["role-1", { id: "role-1", name: "Analyst" }]]),
      membershipsByWorkerId: memberships,
    });
    expect(teamContext?.associations[0]?.teamName).toBe("Ops");
    expect(teamContext?.associations[0]?.roleName).toBe("Analyst");

    const projection = buildOfficeWorkflowHandoffProjection({
      workspaceId: ws,
      workflowNodes: [{ key: "a", type: "AGENT", agentVersionId: av1 }],
      workflowEdges: [],
      nodeRuns: [
        nodeRun({
          id: "nr-a" as WorkflowNodeRunId,
          workflowNodeKey: "a",
          sequence: 1,
          status: "SUCCEEDED",
        }),
      ],
      approvalRequests: [],
      agentVersionsById: agentVersions,
      workersByAgentId: indexOfficeWorkersByAgentId([
        { id: ow1, workspaceId: ws, name: "Only", agentId: agentA },
      ]),
      teamsById: new Map([
        ["team-1", { id: "team-1", workspaceId: ws, name: "Ops" }],
      ]),
      rolesById: new Map([["role-1", { id: "role-1", name: "Analyst" }]]),
      membershipsByWorkerId: memberships,
    });
    expect(projection.nodes[0]?.teamContext?.associations).toHaveLength(1);
  });

  it("rejects cross-workspace node runs", () => {
    expect(() =>
      buildOfficeWorkflowHandoffProjection({
        workspaceId: ws,
        workflowNodes: [{ key: "a", type: "AGENT", agentVersionId: av1 }],
        workflowEdges: [],
        nodeRuns: [
          {
            ...nodeRun({
              id: "nr-a" as WorkflowNodeRunId,
              workflowNodeKey: "a",
              sequence: 1,
              status: "RUNNING",
            }),
            workspaceId: "ws-2" as WorkspaceId,
          },
        ],
        approvalRequests: [],
        agentVersionsById: agentVersions,
        workersByAgentId: new Map(),
      }),
    ).toThrow(/workspace/);
  });

  it("includes unreachable definition nodes as NOT_REACHED", () => {
    const projection = buildOfficeWorkflowHandoffProjection({
      workspaceId: ws,
      workflowNodes: [
        { key: "a", type: "AGENT", agentVersionId: av1 },
        { key: "future", type: "AGENT", agentVersionId: av2 },
      ],
      workflowEdges: [{ from: "a", to: "future" }],
      nodeRuns: [
        nodeRun({
          id: "nr-a" as WorkflowNodeRunId,
          workflowNodeKey: "a",
          sequence: 1,
          status: "RUNNING",
        }),
      ],
      approvalRequests: [],
      agentVersionsById: agentVersions,
      workersByAgentId: new Map(),
    });
    const future = projection.nodes.find((n) => n.workflowNodeKey === "future");
    expect(future?.stepKind).toBe("NOT_REACHED");
  });
});
