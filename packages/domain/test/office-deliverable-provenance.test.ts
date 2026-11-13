import type {
  AssignmentId,
  GoalId,
  RunId,
  WorkflowRunId,
} from "@osva-ai/contracts";
import { describe, expect, it } from "vitest";

import {
  buildOfficeAssignmentExecutionIndex,
  buildWorkflowChildRunToAssignmentsIndex,
  collectWorkflowChildRunBindings,
  resolveOfficeDeliverableMissionAssociation,
  resolveOfficeDeliverableTaskAssociation,
  type OfficeDeliverableAssignmentRecord,
} from "../src/office-deliverable-provenance.js";

const GOAL = "goal-1" as GoalId;
const ASN_AGENT = "asn-agent" as AssignmentId;
const ASN_WF = "asn-wf" as AssignmentId;
const ASN_AMBIG_A = "asn-a" as AssignmentId;
const ASN_AMBIG_B = "asn-b" as AssignmentId;
const RUN_AGENT = "run-agent" as RunId;
const RUN_CHILD = "run-child" as RunId;
const WF_RUN = "wr-1" as WorkflowRunId;

function assignment(
  overrides: Partial<OfficeDeliverableAssignmentRecord> &
    Pick<OfficeDeliverableAssignmentRecord, "id">,
): OfficeDeliverableAssignmentRecord {
  return {
    officeWorkerId: "ow-1" as never,
    targetType: "AGENT_VERSION",
    ...overrides,
  };
}

describe("office deliverable provenance", () => {
  it("links artifact producer to an agent-backed task", () => {
    const assignments = [
      assignment({
        id: ASN_AGENT,
        goalId: GOAL,
        runId: RUN_AGENT,
      }),
    ];
    const index = buildOfficeAssignmentExecutionIndex(assignments);
    const childIndex = buildWorkflowChildRunToAssignmentsIndex([], index);
    const task = resolveOfficeDeliverableTaskAssociation(
      RUN_AGENT,
      index,
      childIndex,
    );
    expect(task).toEqual({ kind: "verified", assignmentId: ASN_AGENT });
    const byId = new Map(assignments.map((row) => [row.id, row]));
    expect(resolveOfficeDeliverableMissionAssociation(task, byId)).toEqual({
      kind: "verified",
      goalId: GOAL,
    });
  });

  it("links artifact producer to a workflow child run task", () => {
    const assignments = [
      assignment({
        id: ASN_WF,
        goalId: GOAL,
        targetType: "WORKFLOW_VERSION",
        workflowRunId: WF_RUN,
      }),
    ];
    const index = buildOfficeAssignmentExecutionIndex(assignments);
    const bindings = collectWorkflowChildRunBindings([
      { workflowRunId: WF_RUN, childRunId: RUN_CHILD },
    ]);
    const childIndex = buildWorkflowChildRunToAssignmentsIndex(bindings, index);
    const task = resolveOfficeDeliverableTaskAssociation(
      RUN_CHILD,
      index,
      childIndex,
    );
    expect(task).toEqual({ kind: "verified", assignmentId: ASN_WF });
  });

  it("returns none for workspace artifact without a task", () => {
    const index = buildOfficeAssignmentExecutionIndex([]);
    const childIndex = buildWorkflowChildRunToAssignmentsIndex([], index);
    expect(
      resolveOfficeDeliverableTaskAssociation(
        "orphan-run" as RunId,
        index,
        childIndex,
      ).kind,
    ).toBe("none");
    expect(
      resolveOfficeDeliverableTaskAssociation(undefined, index, childIndex)
        .kind,
    ).toBe("none");
  });

  it("marks ambiguous when multiple tasks share the same agent run", () => {
    const assignments = [
      assignment({ id: ASN_AMBIG_A, runId: RUN_AGENT }),
      assignment({ id: ASN_AMBIG_B, runId: RUN_AGENT }),
    ];
    const index = buildOfficeAssignmentExecutionIndex(assignments);
    const childIndex = buildWorkflowChildRunToAssignmentsIndex([], index);
    const task = resolveOfficeDeliverableTaskAssociation(
      RUN_AGENT,
      index,
      childIndex,
    );
    expect(task.kind).toBe("ambiguous");
    if (task.kind !== "ambiguous") {
      throw new Error("expected ambiguous task association");
    }
    expect(task.assignmentIds).toEqual([ASN_AMBIG_A, ASN_AMBIG_B]);
  });

  it("marks ambiguous when multiple workflow tasks share a workflow run", () => {
    const assignments = [
      assignment({
        id: ASN_AMBIG_A,
        targetType: "WORKFLOW_VERSION",
        workflowRunId: WF_RUN,
      }),
      assignment({
        id: ASN_AMBIG_B,
        targetType: "WORKFLOW_VERSION",
        workflowRunId: WF_RUN,
      }),
    ];
    const index = buildOfficeAssignmentExecutionIndex(assignments);
    const bindings = collectWorkflowChildRunBindings([
      { workflowRunId: WF_RUN, childRunId: RUN_CHILD },
    ]);
    const childIndex = buildWorkflowChildRunToAssignmentsIndex(bindings, index);
    const task = resolveOfficeDeliverableTaskAssociation(
      RUN_CHILD,
      index,
      childIndex,
    );
    expect(task.kind).toBe("ambiguous");
  });

  it("does not attribute mission without verified task", () => {
    const byId = new Map<AssignmentId, OfficeDeliverableAssignmentRecord>();
    expect(
      resolveOfficeDeliverableMissionAssociation({ kind: "none" }, byId).kind,
    ).toBe("none");
    expect(
      resolveOfficeDeliverableMissionAssociation(
        { kind: "ambiguous", assignmentIds: [ASN_AMBIG_A] },
        byId,
      ).kind,
    ).toBe("none");
  });

  it("deduplicates workflow child run bindings", () => {
    const bindings = collectWorkflowChildRunBindings([
      { workflowRunId: WF_RUN, childRunId: RUN_CHILD },
      { workflowRunId: WF_RUN, childRunId: RUN_CHILD },
      { workflowRunId: WF_RUN, childRunId: "  " },
    ]);
    expect(bindings).toHaveLength(1);
    expect(bindings[0]?.childRunId).toBe(RUN_CHILD);
  });
});
