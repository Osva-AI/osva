import type {
  ApprovalRequestId,
  WorkflowId,
  WorkflowNodeRunId,
  WorkflowRunId,
  WorkflowVersionId,
} from "@osva/contracts";
import {
  ApprovalRequest,
  LifecycleConflictError,
  WorkflowNodeRun,
  WorkflowRun,
} from "@osva/domain";
import { describe, expect, it } from "vitest";

import { MemoryApprovalRequestRepository } from "../src/memory-approval-request-repository.js";
import { MemoryWorkflowRunRepository } from "../src/memory-workflow-run-repository.js";
import { NOW, LATER, otherWorkspaceId, workspaceId } from "./fixtures.js";

const workflowId = "workflow-1" as WorkflowId;
const workflowVersionId = "workflow-version-1" as WorkflowVersionId;
const workflowRunId = "workflow-run-1" as WorkflowRunId;
const workflowNodeRunId = "node-run-1" as WorkflowNodeRunId;
const approvalRequestId = "approval-1" as ApprovalRequestId;

describe("MemoryApprovalRequestRepository", () => {
  it("enforces one ApprovalRequest per WorkflowNodeRun and workspace scoping", async () => {
    const { approvals } = await seed();
    const created = ApprovalRequest.create({
      id: approvalRequestId,
      workspaceId,
      workflowRunId,
      workflowNodeRunId,
      createdAt: NOW,
    });
    await approvals.saveApprovalRequest(created);

    await expect(
      approvals.saveApprovalRequest(
        ApprovalRequest.create({
          id: "approval-2" as ApprovalRequestId,
          workspaceId,
          workflowRunId,
          workflowNodeRunId,
          createdAt: NOW,
        }),
      ),
    ).rejects.toThrow(/already exists/);

    expect(
      await approvals.findApprovalRequestByWorkspaceAndId(
        otherWorkspaceId,
        approvalRequestId,
      ),
    ).toBeNull();
    expect(
      await approvals.findApprovalRequestByWorkspaceAndId(
        workspaceId,
        approvalRequestId,
      ),
    ).not.toBeNull();
  });

  it("makes identical decisions idempotent and rejects conflicting CAS updates", async () => {
    const { approvals } = await seed();
    const pending = ApprovalRequest.create({
      id: approvalRequestId,
      workspaceId,
      workflowRunId,
      workflowNodeRunId,
      createdAt: NOW,
    });
    await approvals.saveApprovalRequest(pending);

    const approved = await approvals.saveApprovalRequestTransition(
      "PENDING",
      pending.markApproved(LATER, "Looks good."),
    );
    expect(approved.status).toBe("APPROVED");
    expect(approved.decidedAt).toEqual(LATER);

    await expect(
      approvals.saveApprovalRequestTransition(
        "PENDING",
        pending.markRejected(LATER, "No"),
      ),
    ).rejects.toBeInstanceOf(LifecycleConflictError);

    const same = await Promise.all([
      decideIfPending(approvals, approved, "APPROVED"),
      decideIfPending(approvals, approved, "APPROVED"),
    ]);
    expect(same.every((result) => result.status === "APPROVED")).toBe(true);
    expect(same[0]?.decisionComment).toBe("Looks good.");
    expect(same[1]?.decidedAt?.getTime()).toBe(approved.decidedAt?.getTime());
  });
});

async function seed(): Promise<{
  readonly approvals: MemoryApprovalRequestRepository;
}> {
  const workflowRuns = new MemoryWorkflowRunRepository();
  await workflowRuns.saveWorkflowRun(
    WorkflowRun.create({
      id: workflowRunId,
      workspaceId,
      workflowId,
      workflowVersionId,
      input: { campaign: "launch" },
      createdAt: NOW,
    }),
  );
  await workflowRuns.saveWorkflowNodeRun(
    WorkflowNodeRun.create({
      id: workflowNodeRunId,
      workspaceId,
      workflowRunId,
      workflowNodeKey: "review",
      sequence: 1,
      input: { campaign: "launch" },
      createdAt: NOW,
    }),
  );
  return { approvals: new MemoryApprovalRequestRepository() };
}

async function decideIfPending(
  approvals: MemoryApprovalRequestRepository,
  current: ApprovalRequest,
  decision: "APPROVED" | "REJECTED",
): Promise<ApprovalRequest> {
  const loaded = await approvals.findApprovalRequestById(current.id);
  if (loaded === null) {
    throw new Error("missing approval");
  }
  if (loaded.status === decision) {
    return loaded;
  }
  try {
    return await approvals.saveApprovalRequestTransition(
      "PENDING",
      decision === "APPROVED"
        ? loaded.markApproved(LATER)
        : loaded.markRejected(LATER),
    );
  } catch (error) {
    if (error instanceof LifecycleConflictError) {
      const reloaded = await approvals.findApprovalRequestById(current.id);
      if (reloaded !== null && reloaded.status === decision) {
        return reloaded;
      }
    }
    throw error;
  }
}
