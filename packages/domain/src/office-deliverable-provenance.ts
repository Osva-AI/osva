import type {
  AssignmentId,
  GoalId,
  OfficeWorkerId,
  RunId,
  WorkflowRunId,
} from "@osva-ai/contracts";

export type OfficeDeliverableTaskAssociation =
  | { readonly kind: "verified"; readonly assignmentId: AssignmentId }
  | {
      readonly kind: "ambiguous";
      readonly assignmentIds: readonly AssignmentId[];
    }
  | { readonly kind: "none" };

export type OfficeDeliverableMissionAssociation =
  | { readonly kind: "verified"; readonly goalId: GoalId }
  | { readonly kind: "none" };

export interface OfficeDeliverableAssignmentRecord {
  readonly id: AssignmentId;
  readonly goalId?: GoalId;
  readonly officeWorkerId: OfficeWorkerId;
  readonly targetType: "AGENT_VERSION" | "WORKFLOW_VERSION";
  readonly runId?: RunId;
  readonly workflowRunId?: WorkflowRunId;
}

export interface OfficeAssignmentExecutionIndex {
  readonly byAgentRunId: ReadonlyMap<RunId, readonly AssignmentId[]>;
  readonly byWorkflowRunId: ReadonlyMap<WorkflowRunId, readonly AssignmentId[]>;
}

export interface WorkflowChildRunBinding {
  readonly workflowRunId: WorkflowRunId;
  readonly childRunId: RunId;
}

export interface WorkflowNodeRunChildRunRecord {
  readonly workflowRunId: WorkflowRunId;
  readonly childRunId?: string;
}

export function buildOfficeAssignmentExecutionIndex(
  assignments: readonly OfficeDeliverableAssignmentRecord[],
): OfficeAssignmentExecutionIndex {
  const byAgentRunId = new Map<RunId, AssignmentId[]>();
  const byWorkflowRunId = new Map<WorkflowRunId, AssignmentId[]>();

  for (const assignment of assignments) {
    if (assignment.runId !== undefined) {
      const existing = byAgentRunId.get(assignment.runId) ?? [];
      existing.push(assignment.id);
      byAgentRunId.set(assignment.runId, existing);
    }
    if (assignment.workflowRunId !== undefined) {
      const existing = byWorkflowRunId.get(assignment.workflowRunId) ?? [];
      existing.push(assignment.id);
      byWorkflowRunId.set(assignment.workflowRunId, existing);
    }
  }

  return { byAgentRunId, byWorkflowRunId };
}

export function collectWorkflowChildRunBindings(
  nodeRuns: readonly WorkflowNodeRunChildRunRecord[],
): WorkflowChildRunBinding[] {
  const bindings: WorkflowChildRunBinding[] = [];
  const seen = new Set<string>();

  for (const nodeRun of nodeRuns) {
    const childRunId = nodeRun.childRunId?.trim();
    if (childRunId === undefined || childRunId.length === 0) {
      continue;
    }
    const dedupeKey = `${nodeRun.workflowRunId}:${childRunId}`;
    if (seen.has(dedupeKey)) {
      continue;
    }
    seen.add(dedupeKey);
    bindings.push({
      workflowRunId: nodeRun.workflowRunId,
      childRunId: childRunId as RunId,
    });
  }

  return bindings;
}

export function buildWorkflowChildRunToAssignmentsIndex(
  childRuns: readonly WorkflowChildRunBinding[],
  index: OfficeAssignmentExecutionIndex,
): ReadonlyMap<RunId, readonly AssignmentId[]> {
  const map = new Map<RunId, AssignmentId[]>();

  for (const binding of childRuns) {
    const assignmentIds =
      index.byWorkflowRunId.get(binding.workflowRunId) ?? [];
    if (assignmentIds.length === 0) {
      continue;
    }
    const existing = map.get(binding.childRunId) ?? [];
    for (const assignmentId of assignmentIds) {
      if (!existing.includes(assignmentId)) {
        existing.push(assignmentId);
      }
    }
    map.set(binding.childRunId, existing);
  }

  return map;
}

export function resolveOfficeDeliverableTaskAssociation(
  producerRunId: RunId | undefined,
  index: OfficeAssignmentExecutionIndex,
  workflowChildIndex: ReadonlyMap<RunId, readonly AssignmentId[]>,
): OfficeDeliverableTaskAssociation {
  if (producerRunId === undefined || producerRunId.length === 0) {
    return { kind: "none" };
  }

  const agentMatches = index.byAgentRunId.get(producerRunId) ?? [];
  if (agentMatches.length === 1) {
    return { kind: "verified", assignmentId: agentMatches[0]! };
  }
  if (agentMatches.length > 1) {
    return { kind: "ambiguous", assignmentIds: agentMatches };
  }

  const workflowMatches = workflowChildIndex.get(producerRunId) ?? [];
  if (workflowMatches.length === 1) {
    return { kind: "verified", assignmentId: workflowMatches[0]! };
  }
  if (workflowMatches.length > 1) {
    return { kind: "ambiguous", assignmentIds: workflowMatches };
  }

  return { kind: "none" };
}

export function resolveOfficeDeliverableMissionAssociation(
  task: OfficeDeliverableTaskAssociation,
  assignmentsById: ReadonlyMap<AssignmentId, OfficeDeliverableAssignmentRecord>,
): OfficeDeliverableMissionAssociation {
  if (task.kind !== "verified") {
    return { kind: "none" };
  }
  const assignment = assignmentsById.get(task.assignmentId);
  if (assignment === undefined || assignment.goalId === undefined) {
    return { kind: "none" };
  }
  return { kind: "verified", goalId: assignment.goalId };
}
