import type {
  WorkflowId,
  WorkflowRunId,
  WorkflowRunState,
  WorkflowVersionId,
} from "@osva/contracts";
import { describe, expect, it } from "vitest";

import { InvalidWorkflowRunTransitionError } from "../src/errors.js";
import { WorkflowRun } from "../src/workflow-run.js";
import {
  isLegalWorkflowRunTransition,
  isTerminalWorkflowRunState,
  LEGAL_WORKFLOW_RUN_TRANSITIONS,
} from "../src/workflow-run-state-machine.js";
import { LATER, NOW, workspaceId } from "./fixtures.js";

const workflowId = "workflow-1" as WorkflowId;
const workflowVersionId = "workflow-version-1" as WorkflowVersionId;
const workflowRunId = "workflow-run-1" as WorkflowRunId;

const LEGAL_TRANSITION_KEYS = new Set(
  LEGAL_WORKFLOW_RUN_TRANSITIONS.map(([from, to]) => `${from}->${to}`),
);

function workflowRunInState(status: WorkflowRunState): WorkflowRun {
  return WorkflowRun.rehydrate({
    id: workflowRunId,
    workspaceId,
    workflowId,
    workflowVersionId,
    status,
    input: { campaign: "launch" },
    createdAt: NOW,
    updatedAt: NOW,
  });
}

describe("WorkflowRun state machine", () => {
  it.each(LEGAL_WORKFLOW_RUN_TRANSITIONS.map(([from, to]) => ({ from, to })))(
    "allows $from -> $to",
    ({ from, to }) => {
      expect(isLegalWorkflowRunTransition(from, to)).toBe(true);
      expect(LEGAL_TRANSITION_KEYS.has(`${from}->${to}`)).toBe(true);
    },
  );

  it("treats SUCCEEDED, FAILED, and CANCELLED as terminal", () => {
    expect(isTerminalWorkflowRunState("SUCCEEDED")).toBe(true);
    expect(isTerminalWorkflowRunState("FAILED")).toBe(true);
    expect(isTerminalWorkflowRunState("CANCELLED")).toBe(true);
    expect(isTerminalWorkflowRunState("RUNNING")).toBe(false);
    expect(isTerminalWorkflowRunState("WAITING")).toBe(false);
  });

  it("rejects transitions from terminal states", () => {
    const cancelled = workflowRunInState("CANCELLED");
    expect(() => cancelled.markRunning(LATER)).toThrow(
      InvalidWorkflowRunTransitionError,
    );
    expect(() => cancelled.markWaiting(LATER)).toThrow(
      InvalidWorkflowRunTransitionError,
    );
  });
});

describe("WorkflowRun WAITING lifecycle", () => {
  it("moves PENDING or RUNNING to WAITING and back to RUNNING", () => {
    const pending = WorkflowRun.create({
      id: workflowRunId,
      workspaceId,
      workflowId,
      workflowVersionId,
      input: { campaign: "launch" },
      createdAt: NOW,
    });
    const waiting = pending.markWaiting(LATER);
    expect(waiting.status).toBe("WAITING");
    expect(waiting.startedAt).toEqual(LATER);

    const resumed = waiting.markRunning(LATER);
    expect(resumed.status).toBe("RUNNING");

    const fromRunning = pending.markRunning(LATER).markWaiting(LATER);
    expect(fromRunning.status).toBe("WAITING");
  });

  it("allows WAITING to succeed or fail, but not resurrect terminals", () => {
    const waiting = WorkflowRun.create({
      id: workflowRunId,
      workspaceId,
      workflowId,
      workflowVersionId,
      input: { campaign: "launch" },
      createdAt: NOW,
    }).markWaiting(LATER);

    const succeeded = waiting.markSucceeded(LATER, { campaign: "launch" });
    expect(succeeded.status).toBe("SUCCEEDED");
    expect(() => succeeded.markWaiting(LATER)).toThrow(
      InvalidWorkflowRunTransitionError,
    );

    const failed = waiting.markFailed(LATER, {
      code: "APPROVAL_REJECTED",
      message: "The approval was rejected.",
    });
    expect(failed.status).toBe("FAILED");
    expect(() => failed.markRunning(LATER)).toThrow(
      InvalidWorkflowRunTransitionError,
    );
  });

  it("marks non-terminal states cancelled with completedAt", () => {
    const pending = WorkflowRun.create({
      id: workflowRunId,
      workspaceId,
      workflowId,
      workflowVersionId,
      input: { campaign: "launch" },
      createdAt: NOW,
    });
    const cancelled = pending.markCancelled(LATER);
    expect(cancelled.status).toBe("CANCELLED");
    expect(cancelled.completedAt).toEqual(LATER);
    expect(cancelled.startedAt).toEqual(LATER);

    const waiting = pending.markWaiting(LATER);
    const cancelledWaiting = waiting.markCancelled(LATER);
    expect(cancelledWaiting.completedAt).toEqual(LATER);
    expect(cancelledWaiting.startedAt).toEqual(LATER);
  });
});
