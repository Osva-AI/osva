import type {
  ApprovalRequestId,
  WorkflowNodeRunId,
  WorkflowRunId,
} from "@osva/contracts";
import { describe, expect, it } from "vitest";

import { ApprovalRequest } from "../src/approval-request.js";
import { InvalidApprovalRequestTransitionError } from "../src/errors.js";
import { LATER, NOW, workspaceId } from "./fixtures.js";

const approvalRequestId = "approval-1" as ApprovalRequestId;
const workflowRunId = "workflow-run-1" as WorkflowRunId;
const workflowNodeRunId = "node-run-1" as WorkflowNodeRunId;

describe("ApprovalRequest", () => {
  it("creates a PENDING request without a decision", () => {
    const request = ApprovalRequest.create({
      id: approvalRequestId,
      workspaceId,
      workflowRunId,
      workflowNodeRunId,
      createdAt: NOW,
    });

    expect(request.status).toBe("PENDING");
    expect(request.decisionComment).toBeUndefined();
    expect(request.decidedAt).toBeUndefined();
  });

  it("records APPROVED and REJECTED decisions immutably", () => {
    const pending = ApprovalRequest.create({
      id: approvalRequestId,
      workspaceId,
      workflowRunId,
      workflowNodeRunId,
      createdAt: NOW,
    });
    const approved = pending.markApproved(LATER, "Looks good.");
    expect(approved.status).toBe("APPROVED");
    expect(approved.decisionComment).toBe("Looks good.");
    expect(approved.decidedAt).toEqual(LATER);
    expect(() => approved.markRejected(LATER)).toThrow(
      InvalidApprovalRequestTransitionError,
    );

    const rejected = pending.markRejected(LATER, "Over budget.");
    expect(rejected.status).toBe("REJECTED");
    expect(() => rejected.markApproved(LATER)).toThrow(
      InvalidApprovalRequestTransitionError,
    );
  });
});
