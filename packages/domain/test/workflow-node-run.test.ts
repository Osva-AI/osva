import type { WorkflowNodeRunId, WorkflowRunId } from "@osva/contracts";
import { WORKFLOW_NODE_RUN_STATES } from "@osva/contracts";
import { describe, expect, it } from "vitest";

import { InvalidWorkflowNodeRunTransitionError } from "../src/errors.js";
import { WorkflowNodeRun } from "../src/workflow-node-run.js";
import {
  isLegalWorkflowNodeRunTransition,
  isTerminalWorkflowNodeRunState,
  LEGAL_WORKFLOW_NODE_RUN_TRANSITIONS,
} from "../src/workflow-node-run-state-machine.js";
import { LATER, NOW, workspaceId } from "./fixtures.js";

const workflowRunId = "workflow-run-1" as WorkflowRunId;
const nodeRunId = "node-run-1" as WorkflowNodeRunId;

describe("WorkflowNodeRun state machine", () => {
  it.each(
    LEGAL_WORKFLOW_NODE_RUN_TRANSITIONS.map(([from, to]) => ({ from, to })),
  )("allows $from -> $to", ({ from, to }) => {
    expect(isLegalWorkflowNodeRunTransition(from, to)).toBe(true);
  });

  it("treats SUCCEEDED, FAILED, SKIPPED, and CANCELLED as terminal", () => {
    for (const state of WORKFLOW_NODE_RUN_STATES) {
      if (
        state === "SUCCEEDED" ||
        state === "FAILED" ||
        state === "SKIPPED" ||
        state === "CANCELLED"
      ) {
        expect(isTerminalWorkflowNodeRunState(state)).toBe(true);
      } else {
        expect(isTerminalWorkflowNodeRunState(state)).toBe(false);
      }
    }
  });

  it("rejects transitions from CANCELLED", () => {
    const cancelled = WorkflowNodeRun.create({
      id: nodeRunId,
      workspaceId,
      workflowRunId,
      workflowNodeKey: "review",
      sequence: 1,
      input: {},
      createdAt: NOW,
    }).markCancelled(LATER);
    expect(() => cancelled.markSucceeded(LATER, {})).toThrow(
      InvalidWorkflowNodeRunTransitionError,
    );
  });
});

describe("WorkflowNodeRun SKIPPED lifecycle", () => {
  it("materializes a durable SKIPPED node without a child Run", () => {
    const skipped = WorkflowNodeRun.createSkipped({
      id: nodeRunId,
      workspaceId,
      workflowRunId,
      workflowNodeKey: "support",
      sequence: 3,
      input: { category: "sales" },
      createdAt: NOW,
    });

    expect(skipped.status).toBe("SKIPPED");
    expect(skipped.childRunId).toBeUndefined();
    expect(skipped.completedAt).toEqual(NOW);
  });

  it("allows PENDING to SKIPPED and rejects SKIPPED reruns", () => {
    const pending = WorkflowNodeRun.create({
      id: nodeRunId,
      workspaceId,
      workflowRunId,
      workflowNodeKey: "support",
      sequence: 3,
      input: { category: "sales" },
      createdAt: NOW,
    });
    const skipped = pending.markSkipped(LATER);
    expect(skipped.status).toBe("SKIPPED");
    expect(() => skipped.markRunning(LATER)).toThrow(
      InvalidWorkflowNodeRunTransitionError,
    );
  });

  it("allows PENDING to WAITING without a child Run", () => {
    const pending = WorkflowNodeRun.create({
      id: nodeRunId,
      workspaceId,
      workflowRunId,
      workflowNodeKey: "review",
      sequence: 2,
      input: { campaign: "launch" },
      createdAt: NOW,
    });
    const waiting = pending.markWaiting(LATER);
    expect(waiting.status).toBe("WAITING");
    expect(waiting.childRunId).toBeUndefined();
    expect(waiting.startedAt).toEqual(LATER);

    const succeeded = waiting.markSucceeded(LATER, waiting.input);
    expect(succeeded.status).toBe("SUCCEEDED");
    expect(succeeded.output).toEqual({ campaign: "launch" });
  });

  it("allows PENDING, RUNNING, and WAITING to CANCELLED", () => {
    const pending = WorkflowNodeRun.create({
      id: nodeRunId,
      workspaceId,
      workflowRunId,
      workflowNodeKey: "review",
      sequence: 2,
      input: {},
      createdAt: NOW,
    });
    expect(pending.markCancelled(LATER).completedAt).toEqual(LATER);

    const running = pending.markRunning(LATER);
    expect(running.markCancelled(LATER).status).toBe("CANCELLED");

    const waiting = pending.markWaiting(LATER);
    expect(waiting.markCancelled(LATER).status).toBe("CANCELLED");
  });

  it("persists a BRANCH selectedTargetKey on success", () => {
    const pending = WorkflowNodeRun.create({
      id: nodeRunId,
      workspaceId,
      workflowRunId,
      workflowNodeKey: "route",
      sequence: 2,
      input: { category: "sales" },
      createdAt: NOW,
    });
    const succeeded = pending
      .markRunning(LATER)
      .markSucceeded(LATER, { category: "sales" }, "sales");
    expect(succeeded.selectedTargetKey).toBe("sales");
    expect(succeeded.output).toEqual({ category: "sales" });
  });
});
