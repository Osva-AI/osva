import {
  buildAgentBackedExecutionContext,
  buildOfficeWorkerAssignmentHistory,
  buildOfficeWorkflowHandoffProjection,
  buildWorkflowBackedExecutionContext,
  indexOfficeWorkersByAgentId,
  type OfficeExecutionAgentVersionRecord,
  type OfficeExecutionAssignmentRecord,
  type OfficeExecutionApprovalRecord,
  type OfficeExecutionNodeRunRecord,
  type OfficeExecutionRoleRecord,
  type OfficeExecutionRunRecord,
  type OfficeExecutionTeamMembershipRecord,
  type OfficeExecutionTeamRecord,
  type OfficeExecutionWorkerRecord,
  type OfficeExecutionWorkflowEdgeDef,
  type OfficeExecutionWorkflowNodeDef,
  type OfficeExecutionWorkflowRunRecord,
  type OfficeAssignmentExecutionContext,
  type OfficeWorkflowHandoffProjection,
  type OfficeWorkerAssignmentHistoryRow,
  type WorkflowHandoffEdgeKind,
} from "@osva/domain/office-execution-context";
import type {
  AgentId,
  AgentVersionId,
  AssignmentId,
  OfficeWorkerId,
  RunId,
  WorkflowNodeRunId,
  WorkflowRunId,
  WorkspaceId,
} from "@osva-ai/contracts";

import type { AgentVersionCatalogResource } from "../hooks/use-agents";
import type {
  OfficeAssignmentResource,
  OfficeWorkerResource,
} from "../hooks/use-office";
import type {
  ApprovalRequestResource,
  WorkflowNodeRunResource,
  WorkflowRunResource,
} from "../hooks/use-workflow-runs";
import type { RunResource } from "../hooks/use-runs";
import type { WorkflowDefinitionView } from "./workflow-definition";

function parseDate(value: string | undefined): Date | undefined {
  return value === undefined ? undefined : new Date(value);
}

export function toOfficeExecutionAssignmentRecord(
  assignment: OfficeAssignmentResource,
): OfficeExecutionAssignmentRecord {
  return {
    id: assignment.id as AssignmentId,
    workspaceId: assignment.workspaceId as WorkspaceId,
    officeWorkerId: assignment.officeWorkerId as OfficeWorkerId,
    title: assignment.title,
    status: assignment.status,
    targetType: assignment.targetType,
    targetVersionId: assignment.targetVersionId,
    runId: assignment.runId as RunId | undefined,
    workflowRunId: assignment.workflowRunId as WorkflowRunId | undefined,
    goalId: assignment.goalId,
    createdAt: new Date(assignment.createdAt),
    startedAt: parseDate(assignment.startedAt),
    completedAt: parseDate(assignment.completedAt),
    cancelledAt: parseDate(assignment.cancelledAt),
  };
}

export function toOfficeExecutionWorkerRecord(
  worker: OfficeWorkerResource,
): OfficeExecutionWorkerRecord {
  return {
    id: worker.id as OfficeWorkerId,
    workspaceId: worker.workspaceId as WorkspaceId,
    name: worker.name,
    agentId: worker.agentId as AgentId,
  };
}

export function toOfficeExecutionRunRecord(
  run: RunResource,
  workspaceId: WorkspaceId,
): OfficeExecutionRunRecord {
  return {
    id: run.id as RunId,
    workspaceId,
    status: run.status,
    createdAt: new Date(run.createdAt),
    updatedAt: new Date(run.updatedAt),
  };
}

export function toOfficeExecutionWorkflowRunRecord(
  workflowRun: WorkflowRunResource,
): OfficeExecutionWorkflowRunRecord {
  return {
    id: workflowRun.id as WorkflowRunId,
    workspaceId: workflowRun.workspaceId as WorkspaceId,
    workflowVersionId: workflowRun.workflowVersionId,
    status: workflowRun.status,
    createdAt: new Date(workflowRun.createdAt),
    startedAt: parseDate(workflowRun.startedAt),
    completedAt: parseDate(workflowRun.completedAt),
    updatedAt: new Date(workflowRun.updatedAt),
  };
}

function toOfficeExecutionNodeRunRecord(
  nodeRun: WorkflowNodeRunResource,
): OfficeExecutionNodeRunRecord {
  return {
    id: nodeRun.id as WorkflowNodeRunId,
    workspaceId: nodeRun.workspaceId as WorkspaceId,
    workflowRunId: nodeRun.workflowRunId as WorkflowRunId,
    workflowNodeKey: nodeRun.workflowNodeKey,
    sequence: nodeRun.sequence,
    status: nodeRun.status,
    childRunId: nodeRun.childRunId as RunId | undefined,
    selectedTargetKey: nodeRun.selectedTargetKey,
    startedAt: parseDate(nodeRun.startedAt),
    completedAt: parseDate(nodeRun.completedAt),
    createdAt: new Date(nodeRun.createdAt),
    updatedAt: new Date(nodeRun.updatedAt),
  };
}

function toOfficeExecutionApprovalRecord(
  request: ApprovalRequestResource,
): OfficeExecutionApprovalRecord {
  return {
    id: request.id as never,
    workspaceId: request.workspaceId as WorkspaceId,
    workflowRunId: request.workflowRunId as WorkflowRunId,
    workflowNodeRunId: request.workflowNodeRunId as WorkflowNodeRunId,
    status: request.status,
    createdAt: new Date(request.createdAt),
    decidedAt: parseDate(request.decidedAt),
  };
}

export function workflowDefinitionToExecutionNodes(
  definition: WorkflowDefinitionView | undefined,
): OfficeExecutionWorkflowNodeDef[] | undefined {
  if (definition === undefined) {
    return undefined;
  }
  return definition.nodes.map((node) => ({
    key: node.key,
    type: node.type,
    agentVersionId:
      node.type === "AGENT" && typeof node.agentVersionId === "string"
        ? (node.agentVersionId as AgentVersionId)
        : undefined,
  }));
}

export function workflowDefinitionToExecutionEdges(
  definition: WorkflowDefinitionView | undefined,
): OfficeExecutionWorkflowEdgeDef[] | undefined {
  if (definition === undefined) {
    return undefined;
  }
  return definition.edges.map((edge) => ({
    from: edge.from,
    to: edge.to,
  }));
}

export function handoffEdgeKindToGraphAppearance(
  kind: WorkflowHandoffEdgeKind,
): "selected" | "inactive" | "skipped" | undefined {
  switch (kind) {
    case "EXECUTED_TRANSITION":
    case "SELECTED_BRANCH":
      return "selected";
    case "INACTIVE_BRANCH":
      return "inactive";
    case "SKIPPED_PATH":
      return "skipped";
    case "DEFINED_CONNECTION":
    case "FAILED_DOWNSTREAM":
      return undefined;
  }
}

export function buildOfficeAssignmentHandoffProjection(props: {
  readonly workspaceId: string;
  readonly workflowDefinition?: WorkflowDefinitionView;
  readonly workflowRun?: WorkflowRunResource;
  readonly workers: readonly OfficeWorkerResource[];
  readonly agentVersionCatalog?: AgentVersionCatalogResource;
  readonly teamsById?: ReadonlyMap<string, OfficeExecutionTeamRecord>;
  readonly rolesById?: ReadonlyMap<string, OfficeExecutionRoleRecord>;
  readonly membershipsByWorkerId?: ReadonlyMap<
    OfficeWorkerId,
    readonly OfficeExecutionTeamMembershipRecord[]
  >;
}): OfficeWorkflowHandoffProjection | undefined {
  if (
    props.workflowRun === undefined ||
    props.workflowDefinition === undefined
  ) {
    return undefined;
  }

  const nodes = workflowDefinitionToExecutionNodes(props.workflowDefinition);
  const edges = workflowDefinitionToExecutionEdges(props.workflowDefinition);
  if (nodes === undefined || edges === undefined) {
    return undefined;
  }

  const workersByAgentId = indexOfficeWorkersByAgentId(
    props.workers.map(toOfficeExecutionWorkerRecord),
  );

  return buildOfficeWorkflowHandoffProjection({
    workspaceId: props.workspaceId as WorkspaceId,
    workflowNodes: nodes,
    workflowEdges: edges,
    nodeRuns: props.workflowRun.nodeRuns.map(toOfficeExecutionNodeRunRecord),
    approvalRequests: props.workflowRun.approvalRequests.map(
      toOfficeExecutionApprovalRecord,
    ),
    agentVersionsById: agentVersionIndexFromCatalog(props.agentVersionCatalog),
    workersByAgentId,
    teamsById: props.teamsById,
    rolesById: props.rolesById,
    membershipsByWorkerId: props.membershipsByWorkerId,
  });
}

export function agentVersionIndexFromCatalog(
  catalog: AgentVersionCatalogResource | undefined,
): Map<AgentVersionId, OfficeExecutionAgentVersionRecord> {
  const map = new Map<AgentVersionId, OfficeExecutionAgentVersionRecord>();
  if (catalog === undefined) {
    return map;
  }
  for (const entry of catalog.entries) {
    for (const version of entry.versions) {
      map.set(version.id as AgentVersionId, {
        id: version.id as AgentVersionId,
        agentId: version.agentId as AgentId,
      });
    }
  }
  return map;
}

export function buildOfficeAssignmentExecutionContext(props: {
  readonly assignment: OfficeAssignmentResource;
  readonly officeWorker: OfficeWorkerResource;
  readonly run?: RunResource;
  readonly workflowRun?: WorkflowRunResource;
  readonly workflowDefinition?: WorkflowDefinitionView;
  readonly workers: readonly OfficeWorkerResource[];
  readonly agentVersionCatalog?: AgentVersionCatalogResource;
}): OfficeAssignmentExecutionContext | undefined {
  const assignment = toOfficeExecutionAssignmentRecord(props.assignment);
  const officeWorker = toOfficeExecutionWorkerRecord(props.officeWorker);
  const workersByAgentId = indexOfficeWorkersByAgentId(
    props.workers.map(toOfficeExecutionWorkerRecord),
  );
  const agentVersionsById = agentVersionIndexFromCatalog(
    props.agentVersionCatalog,
  );

  if (props.assignment.runId !== undefined && props.run !== undefined) {
    return buildAgentBackedExecutionContext({
      assignment,
      officeWorker,
      run: toOfficeExecutionRunRecord(props.run, assignment.workspaceId),
    });
  }

  if (
    props.assignment.workflowRunId !== undefined &&
    props.workflowRun !== undefined
  ) {
    return buildWorkflowBackedExecutionContext({
      assignment,
      officeWorker,
      workflowRun: toOfficeExecutionWorkflowRunRecord(props.workflowRun),
      nodeRuns: props.workflowRun.nodeRuns.map(toOfficeExecutionNodeRunRecord),
      approvalRequests: props.workflowRun.approvalRequests.map(
        toOfficeExecutionApprovalRecord,
      ),
      workflowNodes: workflowDefinitionToExecutionNodes(
        props.workflowDefinition,
      ),
      agentVersionsById,
      workersByAgentId,
    });
  }

  return undefined;
}

export function buildWorkerAssignmentActivityRows(props: {
  readonly workspaceId: string;
  readonly officeWorkerId: string;
  readonly assignments: readonly OfficeAssignmentResource[];
  readonly limit?: number;
}): OfficeWorkerAssignmentHistoryRow[] {
  return buildOfficeWorkerAssignmentHistory({
    workspaceId: props.workspaceId as WorkspaceId,
    officeWorkerId: props.officeWorkerId as OfficeWorkerId,
    assignments: props.assignments.map(toOfficeExecutionAssignmentRecord),
    limit: props.limit,
  });
}

export function workerAssignmentExecutionPath(row: {
  readonly runId?: RunId;
  readonly workflowRunId?: WorkflowRunId;
}): string | undefined {
  if (row.runId !== undefined) {
    return `/runs/${row.runId}`;
  }
  if (row.workflowRunId !== undefined) {
    return `/workflow-runs/${row.workflowRunId}`;
  }
  return undefined;
}
