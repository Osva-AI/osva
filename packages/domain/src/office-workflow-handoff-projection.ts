import type {
  AgentId,
  AgentVersionId,
  ApprovalRequestId,
  OfficeWorkerId,
  RunId,
  WorkflowNodeRunId,
  WorkspaceId,
} from "@osva-ai/contracts";

import {
  indexOfficeWorkersByAgentId,
  resolveWorkflowNodeWorkerAttribution,
  sortOfficeExecutionNodeRuns,
  type OfficeExecutionAgentVersionRecord,
  type OfficeExecutionApprovalRecord,
  type OfficeExecutionNodeRunRecord,
  type OfficeExecutionWorkerRecord,
  type OfficeExecutionWorkflowNodeDef,
  type OfficeWorkerAttributionState,
} from "./office-execution-context-projection.js";

export interface OfficeExecutionWorkflowEdgeDef {
  readonly from: string;
  readonly to: string;
}

export interface OfficeExecutionTeamRecord {
  readonly id: string;
  readonly workspaceId: WorkspaceId;
  readonly name: string;
}

export interface OfficeExecutionRoleRecord {
  readonly id: string;
  readonly name: string;
}

export interface OfficeExecutionTeamMembershipRecord {
  readonly teamId: string;
  readonly officeWorkerId: OfficeWorkerId;
  readonly roleId?: string;
}

export type WorkflowHandoffStepKind =
  | "NOT_REACHED"
  | "PENDING"
  | "RUNNING"
  | "WAITING_FOR_APPROVAL"
  | "WAITING"
  | "COMPLETED_STEP"
  | "SKIPPED_STEP"
  | "FAILED_STEP"
  | "CANCELLED_STEP";

export type WorkflowHandoffEdgeKind =
  | "DEFINED_CONNECTION"
  | "EXECUTED_TRANSITION"
  | "SELECTED_BRANCH"
  | "INACTIVE_BRANCH"
  | "SKIPPED_PATH"
  | "FAILED_DOWNSTREAM";

export interface OfficeWorkerTeamAssociation {
  readonly teamId: string;
  readonly teamName: string;
  readonly roleId?: string;
  readonly roleName?: string;
}

/** Team membership is organizational context only — not ownership or authorization. */
export interface OfficeWorkerTeamContext {
  readonly associations: readonly OfficeWorkerTeamAssociation[];
}

export interface WorkflowHandoffNodeView {
  readonly workflowNodeKey: string;
  readonly nodeType?: string;
  readonly stepKind: WorkflowHandoffStepKind;
  readonly nodeStatus?: string;
  readonly workflowNodeRunId?: WorkflowNodeRunId;
  readonly sequence?: number;
  readonly childRunId?: RunId;
  readonly approvalRequestId?: ApprovalRequestId;
  readonly approvalStatus?: string;
  readonly workerAttribution: OfficeWorkerAttributionState;
  readonly teamContext?: OfficeWorkerTeamContext;
  readonly selectedBranchTargetKey?: string;
}

export interface WorkflowHandoffEdgeView {
  readonly id: string;
  readonly fromKey: string;
  readonly toKey: string;
  readonly kind: WorkflowHandoffEdgeKind;
  readonly terminologyLabel: string;
}

export interface OfficeWorkflowHandoffProjection {
  readonly workspaceId: WorkspaceId;
  readonly nodes: readonly WorkflowHandoffNodeView[];
  readonly edges: readonly WorkflowHandoffEdgeView[];
  readonly blockingNodeKey?: string;
  readonly executionStatusByNodeKey: Readonly<Record<string, string>>;
}

export function workflowHandoffEdgeId(fromKey: string, toKey: string): string {
  return `edge:${fromKey}->${toKey}`;
}

export function workflowHandoffEdgeTerminology(
  kind: WorkflowHandoffEdgeKind,
): string {
  switch (kind) {
    case "DEFINED_CONNECTION":
      return "Defined connection";
    case "EXECUTED_TRANSITION":
      return "Executed workflow step";
    case "SELECTED_BRANCH":
      return "Selected branch";
    case "INACTIVE_BRANCH":
      return "Skipped step (branch not taken)";
    case "SKIPPED_PATH":
      return "Skipped step";
    case "FAILED_DOWNSTREAM":
      return "Failed path (downstream not assumed)";
  }
}

export function compareOfficeExecutionNodeRunsForLatest(
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

export function selectLatestOfficeExecutionNodeRunByKey(
  nodeRuns: readonly OfficeExecutionNodeRunRecord[],
): Map<string, OfficeExecutionNodeRunRecord> {
  const byKey = new Map<string, OfficeExecutionNodeRunRecord>();
  for (const nodeRun of nodeRuns) {
    const existing = byKey.get(nodeRun.workflowNodeKey);
    if (
      existing === undefined ||
      compareOfficeExecutionNodeRunsForLatest(existing, nodeRun) < 0
    ) {
      byKey.set(nodeRun.workflowNodeKey, nodeRun);
    }
  }
  return byKey;
}

export function indexTeamMembershipsByWorkerId(
  memberships: readonly OfficeExecutionTeamMembershipRecord[],
): Map<OfficeWorkerId, OfficeExecutionTeamMembershipRecord[]> {
  const byWorker = new Map<
    OfficeWorkerId,
    OfficeExecutionTeamMembershipRecord[]
  >();
  for (const row of memberships) {
    const list = byWorker.get(row.officeWorkerId) ?? [];
    list.push(row);
    byWorker.set(row.officeWorkerId, list);
  }
  for (const list of byWorker.values()) {
    list.sort((left, right) => left.teamId.localeCompare(right.teamId));
  }
  return byWorker;
}

export function resolveOfficeWorkerTeamContext(props: {
  readonly workspaceId: WorkspaceId;
  readonly officeWorkerId: OfficeWorkerId;
  readonly teamsById: ReadonlyMap<string, OfficeExecutionTeamRecord>;
  readonly rolesById: ReadonlyMap<string, OfficeExecutionRoleRecord>;
  readonly membershipsByWorkerId: ReadonlyMap<
    OfficeWorkerId,
    readonly OfficeExecutionTeamMembershipRecord[]
  >;
}): OfficeWorkerTeamContext | undefined {
  const rows = props.membershipsByWorkerId.get(props.officeWorkerId) ?? [];
  if (rows.length === 0) {
    return undefined;
  }

  const associations: OfficeWorkerTeamAssociation[] = [];
  for (const row of rows) {
    const team = props.teamsById.get(row.teamId);
    if (team === undefined || team.workspaceId !== props.workspaceId) {
      continue;
    }
    const role =
      row.roleId !== undefined ? props.rolesById.get(row.roleId) : undefined;
    associations.push({
      teamId: row.teamId,
      teamName: team.name,
      roleId: row.roleId,
      roleName: role?.name,
    });
  }

  if (associations.length === 0) {
    return undefined;
  }

  return { associations };
}

export function resolveWorkflowHandoffStepKind(props: {
  readonly nodeRun: OfficeExecutionNodeRunRecord | undefined;
  readonly nodeType: string | undefined;
  readonly approvalStatus: string | undefined;
}): WorkflowHandoffStepKind {
  if (props.nodeRun === undefined) {
    return "NOT_REACHED";
  }

  if (props.nodeType === "APPROVAL" && props.nodeRun.status === "WAITING") {
    return "WAITING_FOR_APPROVAL";
  }

  switch (props.nodeRun.status) {
    case "PENDING":
      return "PENDING";
    case "RUNNING":
      return "RUNNING";
    case "WAITING":
      return "WAITING";
    case "SUCCEEDED":
      return "COMPLETED_STEP";
    case "SKIPPED":
      return "SKIPPED_STEP";
    case "FAILED":
      return "FAILED_STEP";
    case "CANCELLED":
      return "CANCELLED_STEP";
    default:
      return "NOT_REACHED";
  }
}

function sourceAllowsHandoff(
  sourceRun: OfficeExecutionNodeRunRecord | undefined,
  sourceType: string | undefined,
): boolean {
  if (sourceRun === undefined) {
    return false;
  }
  if (sourceRun.status === "FAILED") {
    return false;
  }
  if (sourceType === "PARALLEL" || sourceType === "JOIN") {
    return (
      sourceRun.status === "SUCCEEDED" ||
      sourceRun.status === "RUNNING" ||
      sourceRun.status === "WAITING"
    );
  }
  return (
    sourceRun.status === "SUCCEEDED" ||
    sourceRun.status === "RUNNING" ||
    sourceRun.status === "WAITING" ||
    sourceRun.status === "SKIPPED"
  );
}

function targetShowsTraversal(
  targetRun: OfficeExecutionNodeRunRecord,
): boolean {
  return targetRun.status !== "PENDING";
}

export function resolveWorkflowHandoffEdgeKind(props: {
  readonly fromKey: string;
  readonly toKey: string;
  readonly sourceType: string | undefined;
  readonly sourceRun: OfficeExecutionNodeRunRecord | undefined;
  readonly targetRun: OfficeExecutionNodeRunRecord | undefined;
}): WorkflowHandoffEdgeKind {
  const { sourceType, sourceRun, targetRun } = props;

  if (sourceType === "BRANCH") {
    const selected = sourceRun?.selectedTargetKey?.trim() ?? "";
    if (selected.length === 0) {
      return "DEFINED_CONNECTION";
    }
    if (props.toKey === selected) {
      if (targetRun?.status === "SKIPPED") {
        return "SKIPPED_PATH";
      }
      return sourceAllowsHandoff(sourceRun, sourceType) &&
        targetRun !== undefined &&
        targetShowsTraversal(targetRun)
        ? "SELECTED_BRANCH"
        : "DEFINED_CONNECTION";
    }
    if (targetRun?.status === "SKIPPED") {
      return "SKIPPED_PATH";
    }
    return "INACTIVE_BRANCH";
  }

  if (targetRun?.status === "SKIPPED") {
    return "SKIPPED_PATH";
  }

  if (sourceRun?.status === "FAILED") {
    if (targetRun === undefined || targetRun.status === "PENDING") {
      return "FAILED_DOWNSTREAM";
    }
    return "DEFINED_CONNECTION";
  }

  if (targetRun === undefined) {
    return "DEFINED_CONNECTION";
  }

  if (!sourceAllowsHandoff(sourceRun, sourceType)) {
    return "DEFINED_CONNECTION";
  }

  if (!targetShowsTraversal(targetRun)) {
    return "DEFINED_CONNECTION";
  }

  return "EXECUTED_TRANSITION";
}

export function resolveWorkflowBlockingNodeKey(props: {
  readonly nodeViews: readonly WorkflowHandoffNodeView[];
  readonly latestByKey: ReadonlyMap<string, OfficeExecutionNodeRunRecord>;
}): string | undefined {
  const blockers = props.nodeViews.filter((node) => {
    if (
      node.stepKind === "WAITING_FOR_APPROVAL" ||
      node.stepKind === "WAITING" ||
      node.stepKind === "FAILED_STEP"
    ) {
      return true;
    }
    if (node.stepKind === "RUNNING" || node.stepKind === "PENDING") {
      return true;
    }
    return false;
  });

  if (blockers.length === 0) {
    return undefined;
  }

  blockers.sort((left, right) => {
    const leftSeq = left.sequence ?? Number.MAX_SAFE_INTEGER;
    const rightSeq = right.sequence ?? Number.MAX_SAFE_INTEGER;
    if (leftSeq !== rightSeq) {
      return leftSeq - rightSeq;
    }
    return left.workflowNodeKey.localeCompare(right.workflowNodeKey);
  });

  const failed = blockers.find((node) => node.stepKind === "FAILED_STEP");
  if (failed !== undefined) {
    return failed.workflowNodeKey;
  }

  const waiting = blockers.find(
    (node) =>
      node.stepKind === "WAITING_FOR_APPROVAL" || node.stepKind === "WAITING",
  );
  if (waiting !== undefined) {
    return waiting.workflowNodeKey;
  }

  return blockers[0]?.workflowNodeKey;
}

export function buildOfficeWorkflowHandoffProjection(props: {
  readonly workspaceId: WorkspaceId;
  readonly workflowNodes: readonly OfficeExecutionWorkflowNodeDef[];
  readonly workflowEdges: readonly OfficeExecutionWorkflowEdgeDef[];
  readonly nodeRuns: readonly OfficeExecutionNodeRunRecord[];
  readonly approvalRequests: readonly OfficeExecutionApprovalRecord[];
  readonly agentVersionsById: ReadonlyMap<
    AgentVersionId,
    OfficeExecutionAgentVersionRecord
  >;
  readonly workersByAgentId: ReadonlyMap<
    AgentId,
    readonly OfficeExecutionWorkerRecord[]
  >;
  readonly teamsById?: ReadonlyMap<string, OfficeExecutionTeamRecord>;
  readonly rolesById?: ReadonlyMap<string, OfficeExecutionRoleRecord>;
  readonly membershipsByWorkerId?: ReadonlyMap<
    OfficeWorkerId,
    readonly OfficeExecutionTeamMembershipRecord[]
  >;
}): OfficeWorkflowHandoffProjection {
  const nodeDefByKey = new Map(
    props.workflowNodes.map((node) => [node.key, node] as const),
  );
  const latestByKey = selectLatestOfficeExecutionNodeRunByKey(props.nodeRuns);

  const approvalByNodeRunId = new Map<
    WorkflowNodeRunId,
    OfficeExecutionApprovalRecord
  >();
  for (const request of props.approvalRequests) {
    if (request.workspaceId !== props.workspaceId) {
      throw new Error(
        `ApprovalRequest workspace ${request.workspaceId} does not match ${props.workspaceId}.`,
      );
    }
    approvalByNodeRunId.set(request.workflowNodeRunId, request);
  }

  const executionStatusByNodeKey: Record<string, string> = {};
  for (const [key, nodeRun] of latestByKey) {
    executionStatusByNodeKey[key] = nodeRun.status;
  }

  const seenKeys = new Set<string>();
  const nodes: WorkflowHandoffNodeView[] = [];

  const latestEntries = sortOfficeExecutionNodeRuns([...latestByKey.values()]);

  for (const nodeRun of latestEntries) {
    if (nodeRun.workspaceId !== props.workspaceId) {
      throw new Error(
        `NodeRun workspace ${nodeRun.workspaceId} does not match ${props.workspaceId}.`,
      );
    }
    seenKeys.add(nodeRun.workflowNodeKey);

    const def = nodeDefByKey.get(nodeRun.workflowNodeKey);
    const approval = approvalByNodeRunId.get(nodeRun.id);
    const attribution = resolveWorkflowNodeWorkerAttribution({
      workspaceId: props.workspaceId,
      agentVersionId: def?.type === "AGENT" ? def.agentVersionId : undefined,
      agentVersionsById: props.agentVersionsById,
      workersByAgentId: props.workersByAgentId,
    });

    let teamContext: OfficeWorkerTeamContext | undefined;
    if (
      attribution.kind === "RESOLVED" &&
      props.teamsById !== undefined &&
      props.membershipsByWorkerId !== undefined
    ) {
      teamContext = resolveOfficeWorkerTeamContext({
        workspaceId: props.workspaceId,
        officeWorkerId: attribution.officeWorkerId,
        teamsById: props.teamsById,
        rolesById: props.rolesById ?? new Map(),
        membershipsByWorkerId: props.membershipsByWorkerId,
      });
    }

    nodes.push({
      workflowNodeKey: nodeRun.workflowNodeKey,
      nodeType: def?.type,
      stepKind: resolveWorkflowHandoffStepKind({
        nodeRun,
        nodeType: def?.type,
        approvalStatus: approval?.status,
      }),
      nodeStatus: nodeRun.status,
      workflowNodeRunId: nodeRun.id,
      sequence: nodeRun.sequence,
      childRunId: nodeRun.childRunId,
      approvalRequestId: approval?.id,
      approvalStatus: approval?.status,
      workerAttribution: attribution,
      teamContext,
      selectedBranchTargetKey: nodeRun.selectedTargetKey,
    });
  }

  for (const def of props.workflowNodes) {
    if (seenKeys.has(def.key)) {
      continue;
    }
    const attribution = resolveWorkflowNodeWorkerAttribution({
      workspaceId: props.workspaceId,
      agentVersionId: def.type === "AGENT" ? def.agentVersionId : undefined,
      agentVersionsById: props.agentVersionsById,
      workersByAgentId: props.workersByAgentId,
    });
    nodes.push({
      workflowNodeKey: def.key,
      nodeType: def.type,
      stepKind: "NOT_REACHED",
      workerAttribution: attribution,
    });
  }

  nodes.sort((left, right) => {
    const leftSeq = left.sequence ?? Number.MAX_SAFE_INTEGER;
    const rightSeq = right.sequence ?? Number.MAX_SAFE_INTEGER;
    if (leftSeq !== rightSeq) {
      return leftSeq - rightSeq;
    }
    return left.workflowNodeKey.localeCompare(right.workflowNodeKey);
  });

  const edges: WorkflowHandoffEdgeView[] = props.workflowEdges.map((edge) => {
    const sourceDef = nodeDefByKey.get(edge.from);
    const kind = resolveWorkflowHandoffEdgeKind({
      fromKey: edge.from,
      toKey: edge.to,
      sourceType: sourceDef?.type,
      sourceRun: latestByKey.get(edge.from),
      targetRun: latestByKey.get(edge.to),
    });
    return {
      id: workflowHandoffEdgeId(edge.from, edge.to),
      fromKey: edge.from,
      toKey: edge.to,
      kind,
      terminologyLabel: workflowHandoffEdgeTerminology(kind),
    };
  });

  edges.sort((left, right) => left.id.localeCompare(right.id));

  return {
    workspaceId: props.workspaceId,
    nodes,
    edges,
    blockingNodeKey: resolveWorkflowBlockingNodeKey({
      nodeViews: nodes,
      latestByKey,
    }),
    executionStatusByNodeKey,
  };
}

/** Builds worker index for handoff projection inputs. */
export function officeWorkersByAgentIdFromList(
  workers: readonly OfficeExecutionWorkerRecord[],
): Map<string, readonly OfficeExecutionWorkerRecord[]> {
  return indexOfficeWorkersByAgentId(workers);
}
