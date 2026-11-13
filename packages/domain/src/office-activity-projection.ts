import type {
  ApprovalRequestId,
  ArtifactId,
  AssignmentId,
  GoalId,
  OfficeWorkerId,
  RunId,
  WorkflowRunId,
  WorkspaceId,
} from "@osva-ai/contracts";

import {
  buildOfficeAssignmentExecutionIndex,
  buildWorkflowChildRunToAssignmentsIndex,
  collectWorkflowChildRunBindings,
  resolveOfficeDeliverableTaskAssociation,
  type OfficeDeliverableAssignmentRecord,
} from "./office-deliverable-provenance.js";
import {
  type OfficeExecutionApprovalRecord,
  type OfficeExecutionAssignmentRecord,
  type OfficeExecutionNodeRunRecord,
  type OfficeExecutionRunRecord,
  type OfficeExecutionWorkerRecord,
  type OfficeExecutionWorkflowNodeDef,
  type OfficeExecutionWorkflowRunRecord,
  resolveWorkflowNodeWorkerAttribution,
  sortOfficeExecutionNodeRuns,
} from "./office-execution-context-projection.js";
import type { AgentId, AgentVersionId } from "@osva-ai/contracts";

export const OFFICE_ACTIVITY_RECENT_LIMIT = 50;

export const OFFICE_ACTIVITY_TYPES = [
  "TASK_CREATED",
  "TASK_STARTED",
  "TASK_COMPLETED",
  "TASK_FAILED",
  "TASK_CANCELLED",
  "WORKFLOW_NODE_STARTED",
  "WORKFLOW_NODE_COMPLETED",
  "WORKFLOW_NODE_FAILED",
  "WORKFLOW_NODE_SKIPPED",
  "APPROVAL_REQUESTED",
  "APPROVAL_APPROVED",
  "APPROVAL_REJECTED",
  "ARTIFACT_CREATED",
] as const;

export type OfficeActivityType = (typeof OFFICE_ACTIVITY_TYPES)[number];

export type OfficeActivitySourceKind =
  "assignment" | "workflow_node_run" | "approval_request" | "artifact";

export type OfficeActivityNavKind =
  "task" | "run" | "workflow_run" | "approval" | "artifact";

export interface OfficeActivityNavigationTarget {
  readonly kind: OfficeActivityNavKind;
  readonly href: string;
  readonly resourceId: string;
}

export interface OfficeActivityEntry {
  readonly id: string;
  readonly workspaceId: WorkspaceId;
  readonly activityType: OfficeActivityType;
  readonly occurredAt?: string;
  readonly sourceKind: OfficeActivitySourceKind;
  readonly sourceId: string;
  readonly assignmentId?: AssignmentId;
  readonly assignmentTitle?: string;
  readonly goalId?: GoalId;
  readonly officeWorkerId?: OfficeWorkerId;
  readonly executionStatus?: string;
  readonly workflowNodeKey?: string;
  readonly navigation: OfficeActivityNavigationTarget;
}

export interface OfficeActivityArtifactRecord {
  readonly id: ArtifactId;
  readonly workspaceId: WorkspaceId;
  readonly name: string;
  readonly createdAt: string;
  readonly producerRunId?: RunId;
}

export interface OfficeActivityWorkflowSnapshot {
  readonly workflowRun: OfficeExecutionWorkflowRunRecord;
  readonly nodeRuns: readonly OfficeExecutionNodeRunRecord[];
  readonly approvalRequests: readonly OfficeExecutionApprovalRecord[];
  readonly workflowNodes?: readonly OfficeExecutionWorkflowNodeDef[];
}

function assertSameWorkspace(
  expected: WorkspaceId,
  actual: WorkspaceId,
  label: string,
): void {
  if (expected !== actual) {
    throw new Error(
      `${label} workspace ${actual} does not match expected workspace ${expected}.`,
    );
  }
}

const ACTIVITY_TYPE_SORT_RANK: Record<OfficeActivityType, number> = {
  TASK_CREATED: 10,
  TASK_STARTED: 20,
  WORKFLOW_NODE_STARTED: 30,
  APPROVAL_REQUESTED: 40,
  APPROVAL_APPROVED: 50,
  APPROVAL_REJECTED: 50,
  WORKFLOW_NODE_COMPLETED: 60,
  WORKFLOW_NODE_FAILED: 60,
  WORKFLOW_NODE_SKIPPED: 60,
  ARTIFACT_CREATED: 70,
  TASK_COMPLETED: 80,
  TASK_FAILED: 80,
  TASK_CANCELLED: 80,
};

function toIso(date: Date | undefined): string | undefined {
  return date === undefined ? undefined : date.toISOString();
}

function taskNav(assignmentId: AssignmentId): OfficeActivityNavigationTarget {
  return {
    kind: "task",
    href: `/office/tasks/${encodeURIComponent(assignmentId)}`,
    resourceId: assignmentId,
  };
}

function workflowRunNav(
  workflowRunId: WorkflowRunId,
): OfficeActivityNavigationTarget {
  return {
    kind: "workflow_run",
    href: `/workflow-runs/${encodeURIComponent(workflowRunId)}`,
    resourceId: workflowRunId,
  };
}

function runNav(runId: RunId): OfficeActivityNavigationTarget {
  return {
    kind: "run",
    href: `/runs/${encodeURIComponent(runId)}`,
    resourceId: runId,
  };
}

function approvalNav(
  assignmentId: AssignmentId,
  approvalRequestId: ApprovalRequestId,
): OfficeActivityNavigationTarget {
  return {
    kind: "approval",
    href: `/office/tasks/${encodeURIComponent(assignmentId)}#task-approval-${encodeURIComponent(approvalRequestId)}`,
    resourceId: approvalRequestId,
  };
}

function artifactNav(artifactId: ArtifactId): OfficeActivityNavigationTarget {
  return {
    kind: "artifact",
    href: `/office/deliverables?artifact=${encodeURIComponent(artifactId)}`,
    resourceId: artifactId,
  };
}

export function compareOfficeActivityEntries(
  left: OfficeActivityEntry,
  right: OfficeActivityEntry,
): number {
  const leftMs =
    left.occurredAt === undefined
      ? Number.NEGATIVE_INFINITY
      : Date.parse(left.occurredAt);
  const rightMs =
    right.occurredAt === undefined
      ? Number.NEGATIVE_INFINITY
      : Date.parse(right.occurredAt);
  if (leftMs !== rightMs) {
    return rightMs - leftMs;
  }
  const typeDiff =
    ACTIVITY_TYPE_SORT_RANK[left.activityType] -
    ACTIVITY_TYPE_SORT_RANK[right.activityType];
  if (typeDiff !== 0) {
    return typeDiff;
  }
  return left.id.localeCompare(right.id);
}

export function mergeOfficeActivityEntries(
  batches: readonly (readonly OfficeActivityEntry[])[],
): OfficeActivityEntry[] {
  const byId = new Map<string, OfficeActivityEntry>();
  for (const batch of batches) {
    for (const entry of batch) {
      byId.set(entry.id, entry);
    }
  }
  return [...byId.values()].sort(compareOfficeActivityEntries);
}

export function buildOfficeAssignmentLifecycleActivities(
  assignment: OfficeExecutionAssignmentRecord,
  options?: {
    readonly workflowRun?: OfficeExecutionWorkflowRunRecord;
    readonly agentRun?: OfficeExecutionRunRecord;
  },
): OfficeActivityEntry[] {
  if (assignment.workspaceId.length === 0) {
    return [];
  }

  const base = {
    workspaceId: assignment.workspaceId,
    assignmentId: assignment.id,
    assignmentTitle: assignment.title,
    goalId: assignment.goalId as GoalId | undefined,
    officeWorkerId: assignment.officeWorkerId,
    executionStatus: assignment.status,
  };

  const entries: OfficeActivityEntry[] = [
    {
      id: `assignment:${assignment.id}:created`,
      activityType: "TASK_CREATED",
      occurredAt: assignment.createdAt.toISOString(),
      sourceKind: "assignment",
      sourceId: assignment.id,
      navigation: taskNav(assignment.id),
      ...base,
    },
  ];

  const startedAt = toIso(assignment.startedAt);
  if (startedAt !== undefined) {
    entries.push({
      id: `assignment:${assignment.id}:started`,
      activityType: "TASK_STARTED",
      occurredAt: startedAt,
      sourceKind: "assignment",
      sourceId: assignment.id,
      navigation: taskNav(assignment.id),
      ...base,
      executionStatus: assignment.status,
    });
  }

  if (assignment.status === "COMPLETED") {
    const completedAt = toIso(assignment.completedAt);
    if (completedAt !== undefined) {
      entries.push({
        id: `assignment:${assignment.id}:completed`,
        activityType: "TASK_COMPLETED",
        occurredAt: completedAt,
        sourceKind: "assignment",
        sourceId: assignment.id,
        navigation: taskNav(assignment.id),
        ...base,
        executionStatus: "COMPLETED",
      });
    }
  }

  if (assignment.status === "CANCELLED") {
    const cancelledAt = toIso(assignment.cancelledAt);
    if (cancelledAt !== undefined) {
      entries.push({
        id: `assignment:${assignment.id}:cancelled`,
        activityType: "TASK_CANCELLED",
        occurredAt: cancelledAt,
        sourceKind: "assignment",
        sourceId: assignment.id,
        navigation: taskNav(assignment.id),
        ...base,
        executionStatus: "CANCELLED",
      });
    }
  }

  if (assignment.status === "FAILED") {
    const failureAt =
      toIso(assignment.completedAt) ??
      (options?.workflowRun !== undefined &&
      options.workflowRun.id === assignment.workflowRunId
        ? toIso(options.workflowRun.completedAt)
        : undefined);

    entries.push({
      id: `assignment:${assignment.id}:failed`,
      activityType: "TASK_FAILED",
      occurredAt: failureAt,
      sourceKind: "assignment",
      sourceId: assignment.id,
      navigation:
        assignment.workflowRunId !== undefined
          ? workflowRunNav(assignment.workflowRunId)
          : assignment.runId !== undefined
            ? runNav(assignment.runId)
            : taskNav(assignment.id),
      ...base,
      executionStatus: "FAILED",
    });
  }

  return entries;
}

export function buildOfficeWorkflowNodeActivities(props: {
  readonly workspaceId: WorkspaceId;
  readonly assignment: OfficeExecutionAssignmentRecord;
  readonly workflowRun: OfficeExecutionWorkflowRunRecord;
  readonly nodeRuns: readonly OfficeExecutionNodeRunRecord[];
  readonly workflowNodes?: readonly OfficeExecutionWorkflowNodeDef[];
  readonly agentVersionsById: ReadonlyMap<
    AgentVersionId,
    { readonly id: AgentVersionId; readonly agentId: AgentId }
  >;
  readonly workersByAgentId: ReadonlyMap<
    AgentId,
    readonly OfficeExecutionWorkerRecord[]
  >;
}): OfficeActivityEntry[] {
  if (props.assignment.workflowRunId !== props.workflowRun.id) {
    return [];
  }

  assertSameWorkspace(
    props.workspaceId,
    props.workflowRun.workspaceId,
    "WorkflowRun",
  );

  const nodeDefByKey = new Map<string, OfficeExecutionWorkflowNodeDef>();
  for (const node of props.workflowNodes ?? []) {
    nodeDefByKey.set(node.key, node);
  }

  const entries: OfficeActivityEntry[] = [];

  for (const nodeRun of sortOfficeExecutionNodeRuns(props.nodeRuns)) {
    assertSameWorkspace(props.workspaceId, nodeRun.workspaceId, "NodeRun");

    const def = nodeDefByKey.get(nodeRun.workflowNodeKey);
    const attribution = resolveWorkflowNodeWorkerAttribution({
      workspaceId: props.workspaceId,
      agentVersionId: def?.type === "AGENT" ? def.agentVersionId : undefined,
      agentVersionsById: props.agentVersionsById,
      workersByAgentId: props.workersByAgentId,
    });

    const workerId =
      attribution.kind === "RESOLVED"
        ? attribution.officeWorkerId
        : props.assignment.officeWorkerId;

    const base = {
      workspaceId: props.workspaceId,
      assignmentId: props.assignment.id,
      assignmentTitle: props.assignment.title,
      goalId: props.assignment.goalId as GoalId | undefined,
      officeWorkerId: workerId,
      workflowNodeKey: nodeRun.workflowNodeKey,
      executionStatus: nodeRun.status,
    };

    const nodeNav = workflowRunNav(nodeRun.workflowRunId);

    const startedAt = toIso(nodeRun.startedAt);
    if (startedAt !== undefined) {
      entries.push({
        id: `workflow-node:${nodeRun.id}:started`,
        activityType: "WORKFLOW_NODE_STARTED",
        occurredAt: startedAt,
        sourceKind: "workflow_node_run",
        sourceId: nodeRun.id,
        navigation: nodeNav,
        ...base,
      });
    }

    const completedAt = toIso(nodeRun.completedAt);
    if (completedAt !== undefined) {
      let activityType: OfficeActivityType | undefined;
      switch (nodeRun.status) {
        case "SUCCEEDED":
          activityType = "WORKFLOW_NODE_COMPLETED";
          break;
        case "FAILED":
          activityType = "WORKFLOW_NODE_FAILED";
          break;
        case "SKIPPED":
          activityType = "WORKFLOW_NODE_SKIPPED";
          break;
        case "CANCELLED":
          activityType = "WORKFLOW_NODE_FAILED";
          break;
        default:
          activityType = undefined;
      }
      if (activityType !== undefined) {
        entries.push({
          id: `workflow-node:${nodeRun.id}:terminal:${nodeRun.status}`,
          activityType,
          occurredAt: completedAt,
          sourceKind: "workflow_node_run",
          sourceId: nodeRun.id,
          navigation: nodeNav,
          ...base,
        });
      }
    }
  }

  return entries;
}

export function buildOfficeApprovalActivities(props: {
  readonly workspaceId: WorkspaceId;
  readonly assignment: OfficeExecutionAssignmentRecord;
  readonly approvalRequests: readonly OfficeExecutionApprovalRecord[];
}): OfficeActivityEntry[] {
  const entries: OfficeActivityEntry[] = [];

  for (const request of props.approvalRequests) {
    assertSameWorkspace(props.workspaceId, request.workspaceId, "Approval");

    const base = {
      workspaceId: props.workspaceId,
      assignmentId: props.assignment.id,
      assignmentTitle: props.assignment.title,
      goalId: props.assignment.goalId as GoalId | undefined,
      officeWorkerId: props.assignment.officeWorkerId,
      executionStatus: request.status,
    };

    const requestedAt = request.createdAt.toISOString();
    entries.push({
      id: `approval:${request.id}:requested`,
      activityType: "APPROVAL_REQUESTED",
      occurredAt: requestedAt,
      sourceKind: "approval_request",
      sourceId: request.id,
      navigation: approvalNav(props.assignment.id, request.id),
      ...base,
    });

    const decidedAt = toIso(request.decidedAt);
    if (decidedAt !== undefined) {
      if (request.status === "APPROVED") {
        entries.push({
          id: `approval:${request.id}:approved`,
          activityType: "APPROVAL_APPROVED",
          occurredAt: decidedAt,
          sourceKind: "approval_request",
          sourceId: request.id,
          navigation: approvalNav(props.assignment.id, request.id),
          ...base,
          executionStatus: "APPROVED",
        });
      }
      if (request.status === "REJECTED") {
        entries.push({
          id: `approval:${request.id}:rejected`,
          activityType: "APPROVAL_REJECTED",
          occurredAt: decidedAt,
          sourceKind: "approval_request",
          sourceId: request.id,
          navigation: approvalNav(props.assignment.id, request.id),
          ...base,
          executionStatus: "REJECTED",
        });
      }
    }
  }

  return entries;
}

export function buildOfficeArtifactActivities(props: {
  readonly artifacts: readonly OfficeActivityArtifactRecord[];
  readonly assignments: readonly OfficeDeliverableAssignmentRecord[];
  readonly workflowChildBindings: readonly {
    readonly workflowRunId: WorkflowRunId;
    readonly childRunId: RunId;
  }[];
}): OfficeActivityEntry[] {
  const index = buildOfficeAssignmentExecutionIndex(props.assignments);
  const childIndex = buildWorkflowChildRunToAssignmentsIndex(
    props.workflowChildBindings,
    index,
  );
  const assignmentsById = new Map(
    props.assignments.map((row) => [row.id, row]),
  );

  const entries: OfficeActivityEntry[] = [];

  for (const artifact of props.artifacts) {
    const association = resolveOfficeDeliverableTaskAssociation(
      artifact.producerRunId,
      index,
      childIndex,
    );
    if (association.kind !== "verified") {
      continue;
    }

    const assignment = assignmentsById.get(association.assignmentId);
    if (assignment === undefined) {
      continue;
    }

    entries.push({
      id: `artifact:${artifact.id}:created`,
      workspaceId: artifact.workspaceId,
      activityType: "ARTIFACT_CREATED",
      occurredAt: artifact.createdAt,
      sourceKind: "artifact",
      sourceId: artifact.id,
      assignmentId: assignment.id,
      goalId: assignment.goalId as GoalId | undefined,
      officeWorkerId: assignment.officeWorkerId,
      navigation: artifactNav(artifact.id),
      executionStatus: undefined,
    });
  }

  return entries;
}

export function buildOfficeActivitiesForAssignments(props: {
  readonly workspaceId: WorkspaceId;
  readonly assignments: readonly OfficeExecutionAssignmentRecord[];
  readonly workflowSnapshotsByRunId: ReadonlyMap<
    WorkflowRunId,
    OfficeActivityWorkflowSnapshot
  >;
  readonly agentVersionsById: ReadonlyMap<
    AgentVersionId,
    { readonly id: AgentVersionId; readonly agentId: AgentId }
  >;
  readonly workersByAgentId: ReadonlyMap<
    AgentId,
    readonly OfficeExecutionWorkerRecord[]
  >;
}): OfficeActivityEntry[] {
  const lifecycleBatches: OfficeActivityEntry[] = [];
  const workflowBatches: OfficeActivityEntry[] = [];

  for (const assignment of props.assignments) {
    if (assignment.workspaceId !== props.workspaceId) {
      continue;
    }

    const workflowSnapshot =
      assignment.workflowRunId === undefined
        ? undefined
        : props.workflowSnapshotsByRunId.get(assignment.workflowRunId);

    lifecycleBatches.push(
      ...buildOfficeAssignmentLifecycleActivities(assignment, {
        workflowRun: workflowSnapshot?.workflowRun,
      }),
    );

    if (workflowSnapshot !== undefined) {
      workflowBatches.push(
        ...buildOfficeWorkflowNodeActivities({
          workspaceId: props.workspaceId,
          assignment,
          workflowRun: workflowSnapshot.workflowRun,
          nodeRuns: workflowSnapshot.nodeRuns,
          workflowNodes: workflowSnapshot.workflowNodes,
          agentVersionsById: props.agentVersionsById,
          workersByAgentId: props.workersByAgentId,
        }),
        ...buildOfficeApprovalActivities({
          workspaceId: props.workspaceId,
          assignment,
          approvalRequests: workflowSnapshot.approvalRequests,
        }),
      );
    }
  }

  return mergeOfficeActivityEntries([lifecycleBatches, workflowBatches]);
}

export function buildOfficeTaskDetailActivityTimeline(props: {
  readonly workspaceId: WorkspaceId;
  readonly assignment: OfficeExecutionAssignmentRecord;
  readonly workflowSnapshot?: OfficeActivityWorkflowSnapshot;
  readonly agentRun?: OfficeExecutionRunRecord;
  readonly artifacts: readonly OfficeActivityArtifactRecord[];
  readonly deliverableAssignments: readonly OfficeDeliverableAssignmentRecord[];
  readonly workflowChildBindings: readonly {
    readonly workflowRunId: WorkflowRunId;
    readonly childRunId: RunId;
  }[];
  readonly agentVersionsById: ReadonlyMap<
    AgentVersionId,
    { readonly id: AgentVersionId; readonly agentId: AgentId }
  >;
  readonly workersByAgentId: ReadonlyMap<
    AgentId,
    readonly OfficeExecutionWorkerRecord[]
  >;
}): OfficeActivityEntry[] {
  const lifecycle = buildOfficeAssignmentLifecycleActivities(props.assignment, {
    workflowRun: props.workflowSnapshot?.workflowRun,
    agentRun: props.agentRun,
  });

  const workflow =
    props.workflowSnapshot === undefined
      ? []
      : [
          ...buildOfficeWorkflowNodeActivities({
            workspaceId: props.workspaceId,
            assignment: props.assignment,
            workflowRun: props.workflowSnapshot.workflowRun,
            nodeRuns: props.workflowSnapshot.nodeRuns,
            workflowNodes: props.workflowSnapshot.workflowNodes,
            agentVersionsById: props.agentVersionsById,
            workersByAgentId: props.workersByAgentId,
          }),
          ...buildOfficeApprovalActivities({
            workspaceId: props.workspaceId,
            assignment: props.assignment,
            approvalRequests: props.workflowSnapshot.approvalRequests,
          }),
        ];

  const taskArtifacts = props.artifacts.filter((artifact) => {
    const entries = buildOfficeArtifactActivities({
      artifacts: [artifact],
      assignments: props.deliverableAssignments,
      workflowChildBindings: props.workflowChildBindings,
    });
    return entries.some((row) => row.assignmentId === props.assignment.id);
  });

  const artifactBatch = buildOfficeArtifactActivities({
    artifacts: taskArtifacts,
    assignments: props.deliverableAssignments,
    workflowChildBindings: props.workflowChildBindings,
  });

  return mergeOfficeActivityEntries([lifecycle, workflow, artifactBatch]);
}

export interface OfficeActivityFilter {
  readonly activityType?: OfficeActivityType;
  readonly goalId?: GoalId;
  readonly officeWorkerId?: OfficeWorkerId;
  readonly assignmentId?: AssignmentId;
  readonly occurredAfter?: string;
  readonly occurredBefore?: string;
}

export function filterOfficeActivities(
  entries: readonly OfficeActivityEntry[],
  filter: OfficeActivityFilter,
): OfficeActivityEntry[] {
  return entries.filter((entry) => {
    if (
      filter.activityType !== undefined &&
      entry.activityType !== filter.activityType
    ) {
      return false;
    }
    if (filter.goalId !== undefined && entry.goalId !== filter.goalId) {
      return false;
    }
    if (
      filter.officeWorkerId !== undefined &&
      entry.officeWorkerId !== filter.officeWorkerId
    ) {
      return false;
    }
    if (
      filter.assignmentId !== undefined &&
      entry.assignmentId !== filter.assignmentId
    ) {
      return false;
    }
    if (
      filter.occurredAfter !== undefined ||
      filter.occurredBefore !== undefined
    ) {
      if (entry.occurredAt === undefined) {
        return false;
      }
      const ms = Date.parse(entry.occurredAt);
      if (
        filter.occurredAfter !== undefined &&
        ms < Date.parse(filter.occurredAfter)
      ) {
        return false;
      }
      if (
        filter.occurredBefore !== undefined &&
        ms > Date.parse(filter.occurredBefore)
      ) {
        return false;
      }
    }
    return true;
  });
}

export function paginateOfficeActivitiesBounded(
  entries: readonly OfficeActivityEntry[],
  limit: number,
): {
  readonly items: readonly OfficeActivityEntry[];
  readonly truncated: boolean;
} {
  return {
    items: entries.slice(0, limit),
    truncated: entries.length > limit,
  };
}

export function collectWorkflowChildRunBindingsFromNodeRuns(
  nodeRuns: readonly OfficeExecutionNodeRunRecord[],
): { readonly workflowRunId: WorkflowRunId; readonly childRunId: RunId }[] {
  return collectWorkflowChildRunBindings(
    nodeRuns.map((row) => ({
      workflowRunId: row.workflowRunId,
      childRunId: row.childRunId,
    })),
  );
}

export function officeActivityTypeLabel(type: OfficeActivityType): string {
  switch (type) {
    case "TASK_CREATED":
      return "Task created";
    case "TASK_STARTED":
      return "Task started";
    case "TASK_COMPLETED":
      return "Task completed";
    case "TASK_FAILED":
      return "Task failed";
    case "TASK_CANCELLED":
      return "Task cancelled";
    case "WORKFLOW_NODE_STARTED":
      return "Workflow step started";
    case "WORKFLOW_NODE_COMPLETED":
      return "Workflow step completed";
    case "WORKFLOW_NODE_FAILED":
      return "Workflow step failed";
    case "WORKFLOW_NODE_SKIPPED":
      return "Workflow step skipped";
    case "APPROVAL_REQUESTED":
      return "Approval requested";
    case "APPROVAL_APPROVED":
      return "Approval approved";
    case "APPROVAL_REJECTED":
      return "Approval rejected";
    case "ARTIFACT_CREATED":
      return "Deliverable created";
    default: {
      const _exhaustive: never = type;
      return _exhaustive;
    }
  }
}
