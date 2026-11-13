import type {
  AgentId,
  AgentVersionId,
  ArtifactId,
  AssignmentId,
  GoalId,
  OfficeWorkerId,
  RunId,
  WorkflowRunId,
  WorkspaceId,
} from "@osva-ai/contracts";
import {
  buildOfficeActivitiesForAssignments,
  buildOfficeArtifactActivities,
  buildOfficeTaskDetailActivityTimeline,
  collectWorkflowChildRunBindingsFromNodeRuns,
  filterOfficeActivities,
  mergeOfficeActivityEntries,
  OFFICE_ACTIVITY_RECENT_LIMIT,
  paginateOfficeActivitiesBounded,
  type OfficeActivityArtifactRecord,
  type OfficeActivityEntry,
  type OfficeActivityFilter,
  type OfficeActivityWorkflowSnapshot,
} from "@osva/domain/office-activity";
import { indexOfficeWorkersByAgentId } from "@osva/domain/office-execution-context";

import type { AgentVersionCatalogResource } from "../hooks/use-agents";
import type {
  OfficeAssignmentResource,
  OfficeWorkerResource,
} from "../hooks/use-office";
import type { ArtifactResource } from "../hooks/use-runs";
import type { WorkflowRunResource } from "../hooks/use-workflow-runs";
import {
  agentVersionIndexFromCatalog,
  toOfficeExecutionAssignmentRecord,
  toOfficeExecutionRunRecord,
  toOfficeExecutionWorkflowRunRecord,
  workflowDefinitionToExecutionNodes,
} from "./office-execution-context";
import {
  buildOfficeDeliverableProvenanceContext,
  toOfficeDeliverableAssignmentRecords,
  type OfficeDeliverableWorkflowRunSnapshot,
} from "./office-deliverable-provenance";

function parseDate(value: string | undefined): Date | undefined {
  return value === undefined ? undefined : new Date(value);
}

function toNodeRunRecords(
  run: WorkflowRunResource,
): OfficeActivityWorkflowSnapshot["nodeRuns"] {
  return run.nodeRuns.map((nodeRun) => ({
    id: nodeRun.id as never,
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
  }));
}

function toApprovalRecords(
  run: WorkflowRunResource,
): OfficeActivityWorkflowSnapshot["approvalRequests"] {
  return run.approvalRequests.map((request) => ({
    id: request.id as never,
    workspaceId: request.workspaceId as WorkspaceId,
    workflowRunId: request.workflowRunId as WorkflowRunId,
    workflowNodeRunId: request.workflowNodeRunId as never,
    status: request.status,
    decisionComment: request.decisionComment,
    createdAt: new Date(request.createdAt),
    decidedAt: parseDate(request.decidedAt),
  }));
}

export function buildOfficeActivityWorkflowSnapshot(
  workflowRun: WorkflowRunResource,
  definitionNodes: ReturnType<typeof workflowDefinitionToExecutionNodes>,
): OfficeActivityWorkflowSnapshot {
  return {
    workflowRun: toOfficeExecutionWorkflowRunRecord(workflowRun),
    nodeRuns: toNodeRunRecords(workflowRun),
    approvalRequests: toApprovalRecords(workflowRun),
    workflowNodes: definitionNodes,
  };
}

export function toOfficeActivityArtifactRecord(
  artifact: ArtifactResource,
  workspaceId: WorkspaceId,
): OfficeActivityArtifactRecord {
  return {
    id: artifact.id as ArtifactId,
    workspaceId,
    name: artifact.name,
    createdAt: artifact.createdAt,
    producerRunId: artifact.producer?.runId as RunId | undefined,
  };
}

export function buildOfficeWorkerAgentIndex(
  workers: readonly OfficeWorkerResource[],
): ReturnType<typeof indexOfficeWorkersByAgentId> {
  return indexOfficeWorkersByAgentId(
    workers.map((worker) => ({
      id: worker.id as OfficeWorkerId,
      workspaceId: worker.workspaceId as WorkspaceId,
      name: worker.name,
      agentId: worker.agentId as AgentId,
    })),
  );
}

export function buildWorkspaceOfficeActivityFeed(props: {
  readonly workspaceId: WorkspaceId;
  readonly assignments: readonly OfficeAssignmentResource[];
  readonly workflowRuns: readonly OfficeDeliverableWorkflowRunSnapshot[];
  readonly workflowRunResources: readonly WorkflowRunResource[];
  readonly artifacts: readonly ArtifactResource[];
  readonly workers: readonly OfficeWorkerResource[];
  readonly agentVersionCatalog?: AgentVersionCatalogResource;
  readonly filter?: OfficeActivityFilter;
  readonly limit?: number;
}): {
  readonly entries: readonly OfficeActivityEntry[];
  readonly truncated: boolean;
  readonly artifactsBounded: boolean;
  readonly workflowPartial: boolean;
} {
  const assignmentRecords = props.assignments.map(
    toOfficeExecutionAssignmentRecord,
  );

  const snapshotsByRunId = new Map<
    WorkflowRunId,
    OfficeActivityWorkflowSnapshot
  >();
  for (const resource of props.workflowRunResources) {
    const snapshotRow = props.workflowRuns.find(
      (row) => row.workflowRunId === resource.id,
    );
    const nodes = workflowDefinitionToExecutionNodes(snapshotRow?.definition);
    snapshotsByRunId.set(
      resource.id as WorkflowRunId,
      buildOfficeActivityWorkflowSnapshot(resource, nodes),
    );
  }

  const agentVersionsById = agentVersionIndexFromCatalog(
    props.agentVersionCatalog,
  );
  const workersByAgentId = buildOfficeWorkerAgentIndex(props.workers);

  const assignmentActivities = buildOfficeActivitiesForAssignments({
    workspaceId: props.workspaceId,
    assignments: assignmentRecords,
    workflowSnapshotsByRunId: snapshotsByRunId,
    agentVersionsById,
    workersByAgentId,
  });

  const provenance = buildOfficeDeliverableProvenanceContext(
    props.assignments,
    props.workflowRuns,
  );
  const deliverableAssignments = toOfficeDeliverableAssignmentRecords(
    props.assignments,
  );

  const childBindings = snapshotsByRunId.size
    ? [...snapshotsByRunId.values()].flatMap((snapshot) =>
        collectWorkflowChildRunBindingsFromNodeRuns(snapshot.nodeRuns),
      )
    : [];

  const artifactActivities = buildOfficeArtifactActivities({
    artifacts: props.artifacts.map((artifact) =>
      toOfficeActivityArtifactRecord(artifact, props.workspaceId),
    ),
    assignments: deliverableAssignments,
    workflowChildBindings: childBindings,
  });

  const merged = mergeOfficeActivityEntries([
    assignmentActivities,
    artifactActivities,
  ]);

  const filtered =
    props.filter === undefined
      ? merged
      : filterOfficeActivities(merged, props.filter);

  const limit = props.limit ?? OFFICE_ACTIVITY_RECENT_LIMIT;
  const page = paginateOfficeActivitiesBounded(filtered, limit);

  return {
    entries: page.items,
    truncated:
      filtered.length > limit ||
      props.artifacts.length > 0 /* artifact list may be partial */,
    artifactsBounded: true,
    workflowPartial:
      props.workflowRuns.length < props.workflowRunResources.length,
  };
}

export function buildMissionOfficeActivitySummary(props: {
  readonly workspaceId: WorkspaceId;
  readonly goalId: GoalId;
  readonly assignments: readonly OfficeAssignmentResource[];
  readonly workflowRunResources: readonly WorkflowRunResource[];
  readonly workflowRuns: readonly OfficeDeliverableWorkflowRunSnapshot[];
  readonly workers: readonly OfficeWorkerResource[];
  readonly agentVersionCatalog?: AgentVersionCatalogResource;
  readonly limit?: number;
}): readonly OfficeActivityEntry[] {
  const missionAssignments = props.assignments.filter(
    (row) => row.goalId === props.goalId,
  );
  const feed = buildWorkspaceOfficeActivityFeed({
    workspaceId: props.workspaceId,
    assignments: missionAssignments,
    workflowRuns: props.workflowRuns,
    workflowRunResources: props.workflowRunResources,
    artifacts: [],
    workers: props.workers,
    agentVersionCatalog: props.agentVersionCatalog,
    filter: { goalId: props.goalId },
    limit: props.limit ?? 15,
  });
  return feed.entries;
}

export function buildWorkerOfficeActivitySummary(props: {
  readonly workspaceId: WorkspaceId;
  readonly officeWorkerId: OfficeWorkerId;
  readonly assignments: readonly OfficeAssignmentResource[];
  readonly workflowRunResources: readonly WorkflowRunResource[];
  readonly workflowRuns: readonly OfficeDeliverableWorkflowRunSnapshot[];
  readonly workers: readonly OfficeWorkerResource[];
  readonly agentVersionCatalog?: AgentVersionCatalogResource;
  readonly limit?: number;
}): readonly OfficeActivityEntry[] {
  const workerAssignments = props.assignments.filter(
    (row) => row.officeWorkerId === props.officeWorkerId,
  );
  const feed = buildWorkspaceOfficeActivityFeed({
    workspaceId: props.workspaceId,
    assignments: workerAssignments,
    workflowRuns: props.workflowRuns,
    workflowRunResources: props.workflowRunResources,
    artifacts: [],
    workers: props.workers,
    agentVersionCatalog: props.agentVersionCatalog,
    filter: { officeWorkerId: props.officeWorkerId },
    limit: props.limit ?? 15,
  });
  return feed.entries;
}

export {
  OFFICE_ACTIVITY_RECENT_LIMIT,
  type OfficeActivityEntry,
  type OfficeActivityFilter,
};

export function buildTaskDetailOfficeActivityTimeline(props: {
  readonly workspaceId: WorkspaceId;
  readonly assignment: OfficeAssignmentResource;
  readonly workflowRun?: WorkflowRunResource;
  readonly workflowDefinitionNodes: ReturnType<
    typeof workflowDefinitionToExecutionNodes
  >;
  readonly run?: Parameters<typeof toOfficeExecutionRunRecord>[0];
  readonly artifacts: readonly ArtifactResource[];
  readonly workflowRuns: readonly OfficeDeliverableWorkflowRunSnapshot[];
  readonly allAssignments: readonly OfficeAssignmentResource[];
  readonly workers: readonly OfficeWorkerResource[];
  readonly agentVersionCatalog?: AgentVersionCatalogResource;
}): readonly OfficeActivityEntry[] {
  const workflowSnapshot =
    props.workflowRun === undefined
      ? undefined
      : buildOfficeActivityWorkflowSnapshot(
          props.workflowRun,
          props.workflowDefinitionNodes,
        );

  const deliverableAssignments = toOfficeDeliverableAssignmentRecords(
    props.allAssignments,
  );
  const childBindings = props.workflowRuns.flatMap((run) =>
    collectWorkflowChildRunBindingsFromNodeRuns(
      run.nodeRuns.map((nodeRun) => ({
        id: nodeRun.id as never,
        workspaceId: nodeRun.workspaceId as WorkspaceId,
        workflowRunId: run.workflowRunId as WorkflowRunId,
        workflowNodeKey: nodeRun.workflowNodeKey,
        sequence: nodeRun.sequence,
        status: nodeRun.status,
        childRunId: nodeRun.childRunId as RunId | undefined,
        selectedTargetKey: nodeRun.selectedTargetKey,
        startedAt: parseDate(nodeRun.startedAt),
        completedAt: parseDate(nodeRun.completedAt),
        createdAt: new Date(nodeRun.createdAt),
        updatedAt: new Date(nodeRun.updatedAt),
      })),
    ),
  );

  return buildOfficeTaskDetailActivityTimeline({
    workspaceId: props.workspaceId,
    assignment: toOfficeExecutionAssignmentRecord(props.assignment),
    workflowSnapshot,
    agentRun:
      props.run === undefined
        ? undefined
        : toOfficeExecutionRunRecord(props.run, props.workspaceId),
    artifacts: props.artifacts.map((artifact) =>
      toOfficeActivityArtifactRecord(artifact, props.workspaceId),
    ),
    deliverableAssignments,
    workflowChildBindings: childBindings,
    agentVersionsById: agentVersionIndexFromCatalog(props.agentVersionCatalog),
    workersByAgentId: buildOfficeWorkerAgentIndex(props.workers),
  });
}
