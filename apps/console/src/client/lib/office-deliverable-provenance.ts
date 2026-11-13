import type {
  AssignmentId,
  GoalId,
  OfficeWorkerId,
  RunId,
  WorkflowRunId,
} from "@osva-ai/contracts";
import {
  buildOfficeAssignmentExecutionIndex,
  buildWorkflowChildRunToAssignmentsIndex,
  collectWorkflowChildRunBindings,
  resolveOfficeDeliverableMissionAssociation,
  resolveOfficeDeliverableTaskAssociation,
  type OfficeDeliverableAssignmentRecord,
  type OfficeDeliverableMissionAssociation,
  type OfficeDeliverableTaskAssociation,
} from "@osva/domain/office-deliverable-provenance";

import type { OfficeAssignmentResource } from "../hooks/use-office";
import type { ArtifactResource } from "../hooks/use-runs";
import type { WorkflowNodeRunResource } from "../hooks/use-workflow-runs";
import { collectAgentChildRuns } from "./workflow-artifacts";
import type { WorkflowDefinitionView } from "./workflow-definition";

export interface OfficeDeliverableProvenanceView {
  readonly task: OfficeDeliverableTaskAssociation;
  readonly mission: OfficeDeliverableMissionAssociation;
  readonly producerRunId?: string;
}

export interface OfficeDeliverableWorkflowRunSnapshot {
  readonly workflowRunId: string;
  readonly definition?: WorkflowDefinitionView;
  readonly nodeRuns: readonly WorkflowNodeRunResource[];
}

export function toOfficeDeliverableAssignmentRecords(
  assignments: readonly OfficeAssignmentResource[],
): OfficeDeliverableAssignmentRecord[] {
  return assignments.map((assignment) => ({
    id: assignment.id as AssignmentId,
    goalId: assignment.goalId as GoalId | undefined,
    officeWorkerId: assignment.officeWorkerId as OfficeWorkerId,
    targetType: assignment.targetType,
    runId: assignment.runId as RunId | undefined,
    workflowRunId: assignment.workflowRunId as WorkflowRunId | undefined,
  }));
}

export function buildOfficeDeliverableProvenanceContext(
  assignments: readonly OfficeAssignmentResource[],
  workflowRuns: readonly OfficeDeliverableWorkflowRunSnapshot[],
): {
  readonly assignmentsById: ReadonlyMap<
    AssignmentId,
    OfficeDeliverableAssignmentRecord
  >;
  readonly executionIndex: ReturnType<
    typeof buildOfficeAssignmentExecutionIndex
  >;
  readonly workflowChildIndex: ReadonlyMap<RunId, readonly AssignmentId[]>;
} {
  const records = toOfficeDeliverableAssignmentRecords(assignments);
  const assignmentsById = new Map(records.map((row) => [row.id, row]));
  const executionIndex = buildOfficeAssignmentExecutionIndex(records);

  const bindings = workflowRuns.flatMap((run) => {
    if (run.definition === undefined) {
      return collectWorkflowChildRunBindings(
        run.nodeRuns.map((nodeRun) => ({
          workflowRunId: run.workflowRunId as WorkflowRunId,
          childRunId: nodeRun.childRunId,
        })),
      );
    }
    const agentChildren = collectAgentChildRuns(run.definition, run.nodeRuns);
    return agentChildren.map((child) => ({
      workflowRunId: run.workflowRunId as WorkflowRunId,
      childRunId: child.childRunId as RunId,
    }));
  });

  const workflowChildIndex = buildWorkflowChildRunToAssignmentsIndex(
    bindings,
    executionIndex,
  );

  return { assignmentsById, executionIndex, workflowChildIndex };
}

export function resolveArtifactOfficeProvenance(
  artifact: ArtifactResource,
  context: ReturnType<typeof buildOfficeDeliverableProvenanceContext>,
): OfficeDeliverableProvenanceView {
  const producerRunId = artifact.producer?.runId;
  const task = resolveOfficeDeliverableTaskAssociation(
    producerRunId as RunId | undefined,
    context.executionIndex,
    context.workflowChildIndex,
  );
  const mission = resolveOfficeDeliverableMissionAssociation(
    task,
    context.assignmentsById,
  );
  return { task, mission, producerRunId };
}
