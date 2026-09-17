import type {
  WorkflowId,
  WorkflowRunId,
  WorkflowVersionId,
} from "@osva/contracts";
import { describe, expect, it } from "vitest";

import { InvalidWorkflowRunTransitionError } from "../src/errors.js";
import { WorkflowRun } from "../src/workflow-run.js";
import { LATER, NOW, workspaceId } from "./fixtures.js";

const workflowId = "workflow-1" as WorkflowId;
const workflowVersionId = "workflow-version-1" as WorkflowVersionId;
const workflowRunId = "workflow-run-1" as WorkflowRunId;

describe("WorkflowRun WAITING_FOR_APPROVAL lifecycle", () => {
  it("moves PENDING or RUNNING to WAITING_FOR_APPROVAL and back to RUNNING", () => {
    const pending = WorkflowRun.create({
      id: workflowRunId,
      workspaceId,
      workflowId,
      workflowVersionId,
      input: { campaign: "launch" },
      createdAt: NOW,
    });
    const waiting = pending.markWaitingForApproval(LATER);
    expect(waiting.status).toBe("WAITING_FOR_APPROVAL");
    expect(waiting.startedAt).toEqual(LATER);

    const resumed = waiting.markRunning(LATER);
    expect(resumed.status).toBe("RUNNING");

    const fromRunning = pending
      .markRunning(LATER)
      .markWaitingForApproval(LATER);
    expect(fromRunning.status).toBe("WAITING_FOR_APPROVAL");
  });

  it("allows WAITING_FOR_APPROVAL to succeed or fail, but not resurrect terminals", () => {
    const waiting = WorkflowRun.create({
      id: workflowRunId,
      workspaceId,
      workflowId,
      workflowVersionId,
      input: { campaign: "launch" },
      createdAt: NOW,
    }).markWaitingForApproval(LATER);

    const succeeded = waiting.markSucceeded(LATER, { campaign: "launch" });
    expect(succeeded.status).toBe("SUCCEEDED");
    expect(() => succeeded.markWaitingForApproval(LATER)).toThrow(
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
});
