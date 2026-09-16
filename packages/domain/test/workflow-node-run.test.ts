import type { WorkflowNodeRunId, WorkflowRunId } from "@osva/contracts";
import { describe, expect, it } from "vitest";

import { InvalidWorkflowNodeRunTransitionError } from "../src/errors.js";
import { WorkflowNodeRun } from "../src/workflow-node-run.js";
import { LATER, NOW, workspaceId } from "./fixtures.js";

const workflowRunId = "workflow-run-1" as WorkflowRunId;
const nodeRunId = "node-run-1" as WorkflowNodeRunId;

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
