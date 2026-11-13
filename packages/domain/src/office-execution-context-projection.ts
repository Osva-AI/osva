import type {
  AgentId,
  AgentVersionId,
  ApprovalRequestId,
  AssignmentId,
  AssignmentState,
  OfficeWorkerId,
  RunId,
  WorkflowNodeRunId,
  WorkflowRunId,
  WorkspaceId,
} from "@osva-ai/contracts";

export const WORKFLOW_NODE_EXECUTION_STATUSES = [
  "PENDING",
  "RUNNING",
  "WAITING",
  "SUCCEEDED",
  "FAILED",
  "SKIPPED",
  "CANCELLED",
] as const;

export type WorkflowNodeExecutionStatus =
  (typeof WORKFLOW_NODE_EXECUTION_STATUSES)[number];

export function isWorkflowNodeExecutionStatus(
  status: string,
): status is WorkflowNodeExecutionStatus {
  return (WORKFLOW_NODE_EXECUTION_STATUSES as readonly string[]).includes(
    status,
  );
}

export interface OfficeExecutionAssignmentRecord {
  readonly id: AssignmentId;
  readonly workspaceId: WorkspaceId;
  readonly officeWorkerId: OfficeWorkerId;
  readonly title: string;
  readonly status: AssignmentState;
  readonly targetType: "AGENT_VERSION" | "WORKFLOW_VERSION";
  readonly targetVersionId: string;
  readonly runId?: RunId;
  readonly workflowRunId?: WorkflowRunId;
  readonly goalId?: string;
  readonly createdAt: Date;
  readonly startedAt?: Date;
  readonly completedAt?: Date;
  readonly cancelledAt?: Date;
}

export interface OfficeExecutionWorkerRecord {
  readonly id: OfficeWorkerId;
  readonly workspaceId: WorkspaceId;
  readonly name: string;
  readonly agentId: AgentId;
}

export interface OfficeExecutionRunRecord {
  readonly id: RunId;
  readonly workspaceId: WorkspaceId;
  readonly status: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface OfficeExecutionWorkflowRunRecord {
  readonly id: WorkflowRunId;
  readonly workspaceId: WorkspaceId;
  readonly workflowVersionId: string;
  readonly status: string;
  readonly createdAt: Date;
  readonly startedAt?: Date;
  readonly completedAt?: Date;
  readonly updatedAt: Date;
}

export interface OfficeExecutionNodeRunRecord {
  readonly id: WorkflowNodeRunId;
  readonly workspaceId: WorkspaceId;
  readonly workflowRunId: WorkflowRunId;
  readonly workflowNodeKey: string;
  readonly sequence: number;
  readonly status: string;
  readonly childRunId?: RunId;
  readonly startedAt?: Date;
  readonly completedAt?: Date;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface OfficeExecutionApprovalRecord {
  readonly id: ApprovalRequestId;
  readonly workspaceId: WorkspaceId;
  readonly workflowRunId: WorkflowRunId;
  readonly workflowNodeRunId: WorkflowNodeRunId;
  readonly status: string;
  readonly createdAt: Date;
  readonly decidedAt?: Date;
}

export interface OfficeExecutionWorkflowNodeDef {
  readonly key: string;
  readonly type: string;
  readonly agentVersionId?: AgentVersionId;
}

export interface OfficeExecutionAgentVersionRecord {
  readonly id: AgentVersionId;
  readonly agentId: AgentId;
}

export type OfficeWorkerAttributionState =
  | {
      readonly kind: "RESOLVED";
      readonly officeWorkerId: OfficeWorkerId;
      readonly officeWorkerName: string;
    }
  | {
      readonly kind: "UNAVAILABLE";
      readonly reason: "AMBIGUOUS_WORKERS" | "NO_REGISTERED_WORKER";
      readonly agentId?: AgentId;
      readonly agentVersionId?: AgentVersionId;
    };

export interface AgentBackedExecutionContext {
  readonly kind: "AGENT_RUN";
  readonly assignmentId: AssignmentId;
  readonly workspaceId: WorkspaceId;
  readonly assignmentStatus: AssignmentState;
  readonly officeWorkerId: OfficeWorkerId;
  readonly runId: RunId;
  readonly runStatus: string;
  readonly runCreatedAt: string;
  readonly runUpdatedAt: string;
  readonly assignmentCreatedAt: string;
  readonly assignmentStartedAt?: string;
  readonly assignmentCompletedAt?: string;
}

export interface WorkflowNodeTimelineEntry {
  readonly workflowNodeRunId: WorkflowNodeRunId;
  readonly workflowNodeKey: string;
  readonly nodeType?: string;
  readonly sequence: number;
  readonly nodeStatus: string;
  readonly startedAt?: string;
  readonly completedAt?: string;
  readonly childRunId?: RunId;
  readonly approvalRequestId?: ApprovalRequestId;
  readonly approvalStatus?: string;
  readonly workerAttribution: OfficeWorkerAttributionState;
}

export interface WorkflowBackedExecutionContext {
  readonly kind: "WORKFLOW_RUN";
  readonly assignmentId: AssignmentId;
  readonly workspaceId: WorkspaceId;
  readonly assignmentStatus: AssignmentState;
  readonly officeWorkerId: OfficeWorkerId;
  readonly workflowRunId: WorkflowRunId;
  readonly workflowVersionId: string;
  readonly workflowRunStatus: string;
  readonly workflowRunCreatedAt: string;
  readonly workflowRunStartedAt?: string;
  readonly workflowRunCompletedAt?: string;
  readonly timeline: readonly WorkflowNodeTimelineEntry[];
}

export type OfficeAssignmentExecutionContext =
  AgentBackedExecutionContext | WorkflowBackedExecutionContext;

export interface OfficeWorkerAssignmentHistoryRow {
  readonly assignmentId: AssignmentId;
  readonly title: string;
  readonly status: AssignmentState;
  readonly goalId?: string;
  readonly runId?: RunId;
  readonly workflowRunId?: WorkflowRunId;
  readonly createdAt: string;
  readonly startedAt?: string;
  readonly completedAt?: string;
  readonly cancelledAt?: string;
}

function assertSameWorkspace(
  expected: WorkspaceId,
  actual: WorkspaceId,
  label: string,
): void {
  if (expected !== actual) {
    throw new Error(
      `${label} workspace ${actual} does not match assignment workspace ${expected}.`,
    );
  }
}

function toIso(date: Date | undefined): string | undefined {
  return date === undefined ? undefined : date.toISOString();
}

export function compareOfficeExecutionNodeRuns(
  left: OfficeExecutionNodeRunRecord,
  right: OfficeExecutionNodeRunRecord,
): number {
  if (left.sequence !== right.sequence) {
    return left.sequence - right.sequence;
  }
  if (left.updatedAt.getTime() !== right.updatedAt.getTime()) {
    return left.updatedAt.getTime() - right.updatedAt.getTime();
  }
  return left.id.localeCompare(right.id);
}

export function sortOfficeExecutionNodeRuns(
  nodeRuns: readonly OfficeExecutionNodeRunRecord[],
): OfficeExecutionNodeRunRecord[] {
  return [...nodeRuns].sort(compareOfficeExecutionNodeRuns);
}

export function indexOfficeWorkersByAgentId(
  workers: readonly OfficeExecutionWorkerRecord[],
): Map<AgentId, OfficeExecutionWorkerRecord[]> {
  const byAgent = new Map<AgentId, OfficeExecutionWorkerRecord[]>();
  for (const worker of workers) {
    const rows = byAgent.get(worker.agentId) ?? [];
    rows.push(worker);
    byAgent.set(worker.agentId, rows);
  }
  for (const rows of byAgent.values()) {
    rows.sort((left, right) => left.id.localeCompare(right.id));
  }
  return byAgent;
}

export function resolveWorkflowNodeWorkerAttribution(props: {
  readonly workspaceId: WorkspaceId;
  readonly agentVersionId: AgentVersionId | undefined;
  readonly agentVersionsById: ReadonlyMap<
    AgentVersionId,
    OfficeExecutionAgentVersionRecord
  >;
  readonly workersByAgentId: ReadonlyMap<
    AgentId,
    readonly OfficeExecutionWorkerRecord[]
  >;
}): OfficeWorkerAttributionState {
  if (props.agentVersionId === undefined) {
    return { kind: "UNAVAILABLE", reason: "NO_REGISTERED_WORKER" };
  }

  const version = props.agentVersionsById.get(props.agentVersionId);
  if (version === undefined) {
    return {
      kind: "UNAVAILABLE",
      reason: "NO_REGISTERED_WORKER",
      agentVersionId: props.agentVersionId,
    };
  }

  const candidates = (props.workersByAgentId.get(version.agentId) ?? []).filter(
    (worker) => worker.workspaceId === props.workspaceId,
  );

  if (candidates.length === 1) {
    const worker = candidates[0]!;
    return {
      kind: "RESOLVED",
      officeWorkerId: worker.id,
      officeWorkerName: worker.name,
    };
  }

  if (candidates.length > 1) {
    return {
      kind: "UNAVAILABLE",
      reason: "AMBIGUOUS_WORKERS",
      agentId: version.agentId,
      agentVersionId: props.agentVersionId,
    };
  }

  return {
    kind: "UNAVAILABLE",
    reason: "NO_REGISTERED_WORKER",
    agentId: version.agentId,
    agentVersionId: props.agentVersionId,
  };
}

function workflowNodeDefByKey(
  nodes: readonly OfficeExecutionWorkflowNodeDef[] | undefined,
): Map<string, OfficeExecutionWorkflowNodeDef> {
  const byKey = new Map<string, OfficeExecutionWorkflowNodeDef>();
  if (nodes === undefined) {
    return byKey;
  }
  for (const node of nodes) {
    byKey.set(node.key, node);
  }
  return byKey;
}

export function buildWorkflowExecutionTimeline(props: {
  readonly workspaceId: WorkspaceId;
  readonly nodeRuns: readonly OfficeExecutionNodeRunRecord[];
  readonly approvalRequests: readonly OfficeExecutionApprovalRecord[];
  readonly workflowNodes?: readonly OfficeExecutionWorkflowNodeDef[];
  readonly agentVersionsById: ReadonlyMap<
    AgentVersionId,
    OfficeExecutionAgentVersionRecord
  >;
  readonly workersByAgentId: ReadonlyMap<
    AgentId,
    readonly OfficeExecutionWorkerRecord[]
  >;
}): WorkflowNodeTimelineEntry[] {
  const approvalByNodeRunId = new Map<
    WorkflowNodeRunId,
    OfficeExecutionApprovalRecord
  >();
  for (const request of props.approvalRequests) {
    assertSameWorkspace(
      props.workspaceId,
      request.workspaceId,
      "ApprovalRequest",
    );
    approvalByNodeRunId.set(request.workflowNodeRunId, request);
  }

  const nodeDefByKey = workflowNodeDefByKey(props.workflowNodes);

  return sortOfficeExecutionNodeRuns(props.nodeRuns).map((nodeRun) => {
    assertSameWorkspace(props.workspaceId, nodeRun.workspaceId, "NodeRun");
    const def = nodeDefByKey.get(nodeRun.workflowNodeKey);
    const approval = approvalByNodeRunId.get(nodeRun.id);
    const attribution = resolveWorkflowNodeWorkerAttribution({
      workspaceId: props.workspaceId,
      agentVersionId: def?.type === "AGENT" ? def.agentVersionId : undefined,
      agentVersionsById: props.agentVersionsById,
      workersByAgentId: props.workersByAgentId,
    });

    return {
      workflowNodeRunId: nodeRun.id,
      workflowNodeKey: nodeRun.workflowNodeKey,
      nodeType: def?.type,
      sequence: nodeRun.sequence,
      nodeStatus: nodeRun.status,
      startedAt: toIso(nodeRun.startedAt),
      completedAt: toIso(nodeRun.completedAt),
      childRunId: nodeRun.childRunId,
      approvalRequestId: approval?.id,
      approvalStatus: approval?.status,
      workerAttribution: attribution,
    };
  });
}

export function buildAgentBackedExecutionContext(props: {
  readonly assignment: OfficeExecutionAssignmentRecord;
  readonly officeWorker: OfficeExecutionWorkerRecord;
  readonly run: OfficeExecutionRunRecord;
}): AgentBackedExecutionContext {
  assertSameWorkspace(
    props.assignment.workspaceId,
    props.officeWorker.workspaceId,
    "OfficeWorker",
  );
  assertSameWorkspace(
    props.assignment.workspaceId,
    props.run.workspaceId,
    "Run",
  );

  if (
    props.assignment.runId === undefined ||
    props.assignment.runId !== props.run.id
  ) {
    throw new Error("Assignment runId does not match Run record.");
  }

  if (props.assignment.officeWorkerId !== props.officeWorker.id) {
    throw new Error("Assignment officeWorkerId does not match OfficeWorker.");
  }

  return {
    kind: "AGENT_RUN",
    assignmentId: props.assignment.id,
    workspaceId: props.assignment.workspaceId,
    assignmentStatus: props.assignment.status,
    officeWorkerId: props.officeWorker.id,
    runId: props.run.id,
    runStatus: props.run.status,
    runCreatedAt: props.run.createdAt.toISOString(),
    runUpdatedAt: props.run.updatedAt.toISOString(),
    assignmentCreatedAt: props.assignment.createdAt.toISOString(),
    assignmentStartedAt: toIso(props.assignment.startedAt),
    assignmentCompletedAt: toIso(props.assignment.completedAt),
  };
}

export function buildWorkflowBackedExecutionContext(props: {
  readonly assignment: OfficeExecutionAssignmentRecord;
  readonly officeWorker: OfficeExecutionWorkerRecord;
  readonly workflowRun: OfficeExecutionWorkflowRunRecord;
  readonly nodeRuns: readonly OfficeExecutionNodeRunRecord[];
  readonly approvalRequests: readonly OfficeExecutionApprovalRecord[];
  readonly workflowNodes?: readonly OfficeExecutionWorkflowNodeDef[];
  readonly agentVersionsById: ReadonlyMap<
    AgentVersionId,
    OfficeExecutionAgentVersionRecord
  >;
  readonly workersByAgentId: ReadonlyMap<
    AgentId,
    readonly OfficeExecutionWorkerRecord[]
  >;
}): WorkflowBackedExecutionContext {
  assertSameWorkspace(
    props.assignment.workspaceId,
    props.officeWorker.workspaceId,
    "OfficeWorker",
  );
  assertSameWorkspace(
    props.assignment.workspaceId,
    props.workflowRun.workspaceId,
    "WorkflowRun",
  );

  if (
    props.assignment.workflowRunId === undefined ||
    props.assignment.workflowRunId !== props.workflowRun.id
  ) {
    throw new Error("Assignment workflowRunId does not match WorkflowRun.");
  }

  const timeline = buildWorkflowExecutionTimeline({
    workspaceId: props.assignment.workspaceId,
    nodeRuns: props.nodeRuns,
    approvalRequests: props.approvalRequests,
    workflowNodes: props.workflowNodes,
    agentVersionsById: props.agentVersionsById,
    workersByAgentId: props.workersByAgentId,
  });

  return {
    kind: "WORKFLOW_RUN",
    assignmentId: props.assignment.id,
    workspaceId: props.assignment.workspaceId,
    assignmentStatus: props.assignment.status,
    officeWorkerId: props.officeWorker.id,
    workflowRunId: props.workflowRun.id,
    workflowVersionId: props.workflowRun.workflowVersionId,
    workflowRunStatus: props.workflowRun.status,
    workflowRunCreatedAt: props.workflowRun.createdAt.toISOString(),
    workflowRunStartedAt: toIso(props.workflowRun.startedAt),
    workflowRunCompletedAt: toIso(props.workflowRun.completedAt),
    timeline,
  };
}

export function buildOfficeWorkerAssignmentHistory(props: {
  readonly workspaceId: WorkspaceId;
  readonly officeWorkerId: OfficeWorkerId;
  readonly assignments: readonly OfficeExecutionAssignmentRecord[];
  readonly limit?: number;
}): OfficeWorkerAssignmentHistoryRow[] {
  const max = props.limit ?? 25;
  const rows = props.assignments
    .filter(
      (assignment) =>
        assignment.workspaceId === props.workspaceId &&
        assignment.officeWorkerId === props.officeWorkerId,
    )
    .sort((left, right) => {
      const leftTs = left.createdAt.getTime();
      const rightTs = right.createdAt.getTime();
      if (leftTs !== rightTs) {
        return rightTs - leftTs;
      }
      return right.id.localeCompare(left.id);
    })
    .slice(0, max)
    .map((assignment): OfficeWorkerAssignmentHistoryRow => ({
      assignmentId: assignment.id,
      title: assignment.title,
      status: assignment.status,
      goalId: assignment.goalId,
      runId: assignment.runId,
      workflowRunId: assignment.workflowRunId,
      createdAt: assignment.createdAt.toISOString(),
      startedAt: toIso(assignment.startedAt),
      completedAt: toIso(assignment.completedAt),
      cancelledAt: toIso(assignment.cancelledAt),
    }));
  return rows;
}
