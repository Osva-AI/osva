import type {
  ApprovalRequestId,
  JsonValue,
  ToolVersionId,
  WorkflowNodeRunId,
  WorkflowRunId,
} from "@osva-ai/contracts";
import { APPROVAL_OPERATION_KINDS } from "@osva-ai/contracts";
import { describe, expect, it } from "vitest";

import { ApprovalRequest } from "../src/approval-request.js";
import {
  assertApprovalDecisionAuthorizesOperation,
  assertToolInvocationMatchesApprovalBinding,
  buildToolInvocationBinding,
  digestApprovalOperationBinding,
  recomputeWorkflowNodeProgressionDigest,
} from "../src/approval-operation-binding.js";
import {
  ApprovalExpiredError,
  ApprovalOperationMismatchError,
} from "../src/errors.js";
import { WorkflowNodeRun } from "../src/workflow-node-run.js";
import { LATER, NOW, workspaceId } from "./fixtures.js";

const approvalRequestId = "approval-bind-1" as ApprovalRequestId;
const workflowRunId = "workflow-run-bind-1" as WorkflowRunId;
const workflowNodeRunId = "node-run-bind-1" as WorkflowNodeRunId;

describe("approval operation binding", () => {
  it("binds workflow node progression to canonical input digest", () => {
    const nodeRun = WorkflowNodeRun.create({
      id: workflowNodeRunId,
      workspaceId,
      workflowRunId,
      workflowNodeKey: "review",
      sequence: 1,
      input: { amount: 100, note: "launch" },
      createdAt: NOW,
    }).markWaiting(NOW);

    const request = ApprovalRequest.createForWorkflowNodeProgression({
      id: approvalRequestId,
      workspaceId,
      workflowRunId,
      workflowNodeRunId: nodeRun.id,
      nodeInput: nodeRun.input as JsonValue,
      createdAt: NOW,
    });

    expect(request.operationKind).toBe(
      APPROVAL_OPERATION_KINDS.WORKFLOW_NODE_PROGRESSION,
    );
    expect(request.operationDigest).toBe(
      recomputeWorkflowNodeProgressionDigest(nodeRun),
    );

    assertApprovalDecisionAuthorizesOperation({
      request,
      nodeRun,
      decision: "APPROVED",
      now: LATER,
    });
  });

  it("rejects modified operation payload at decision time", () => {
    const nodeRun = WorkflowNodeRun.create({
      id: workflowNodeRunId,
      workspaceId,
      workflowRunId,
      workflowNodeKey: "review",
      sequence: 1,
      input: { amount: 100 },
      createdAt: NOW,
    }).markWaiting(NOW);

    const request = ApprovalRequest.createForWorkflowNodeProgression({
      id: approvalRequestId,
      workspaceId,
      workflowRunId,
      workflowNodeRunId: nodeRun.id,
      nodeInput: nodeRun.input as JsonValue,
      createdAt: NOW,
    });

    const tampered = WorkflowNodeRun.create({
      id: workflowNodeRunId,
      workspaceId,
      workflowRunId,
      workflowNodeKey: "review",
      sequence: 1,
      input: { amount: 999 },
      createdAt: NOW,
    }).markWaiting(NOW);

    expect(() =>
      assertApprovalDecisionAuthorizesOperation({
        request,
        nodeRun: tampered,
        decision: "APPROVED",
        now: LATER,
      }),
    ).toThrow(ApprovalOperationMismatchError);
  });

  it("rejects expired approvals on APPROVED decisions", () => {
    const nodeRun = WorkflowNodeRun.create({
      id: workflowNodeRunId,
      workspaceId,
      workflowRunId,
      workflowNodeKey: "review",
      sequence: 1,
      input: { ok: true },
      createdAt: NOW,
    }).markWaiting(NOW);

    const request = ApprovalRequest.createForWorkflowNodeProgression({
      id: approvalRequestId,
      workspaceId,
      workflowRunId,
      workflowNodeRunId: nodeRun.id,
      nodeInput: nodeRun.input as JsonValue,
      createdAt: NOW,
      expiresAt: NOW,
    });

    expect(() =>
      assertApprovalDecisionAuthorizesOperation({
        request,
        nodeRun,
        decision: "APPROVED",
        now: LATER,
      }),
    ).toThrow(ApprovalExpiredError);
  });

  it("detects modified tool identity in tool invocation bindings", () => {
    const binding = buildToolInvocationBinding({
      workspaceId,
      workflowRunId,
      runId: "run-1",
      runAttemptId: "attempt-1",
      bindingName: "notify",
      toolVersionId: "tv-1" as ToolVersionId,
      arguments: { channel: "ops" },
    });
    const digest = digestApprovalOperationBinding(binding);

    expect(() =>
      assertToolInvocationMatchesApprovalBinding({
        operationKind: APPROVAL_OPERATION_KINDS.TOOL_INVOCATION,
        operationDigest: digest,
        context: {
          workspaceId,
          workflowRunId,
          runId: "run-1",
          runAttemptId: "attempt-1",
          bindingName: "notify",
          toolVersionId: "tv-2" as ToolVersionId,
          arguments: { channel: "ops" },
        },
      }),
    ).toThrow(ApprovalOperationMismatchError);
  });

  it("preserves legacy approvals without operation binding metadata", () => {
    const nodeRun = WorkflowNodeRun.create({
      id: workflowNodeRunId,
      workspaceId,
      workflowRunId,
      workflowNodeKey: "review",
      sequence: 1,
      input: { legacy: true },
      createdAt: NOW,
    }).markWaiting(NOW);

    const legacy = ApprovalRequest.create({
      id: approvalRequestId,
      workspaceId,
      workflowRunId,
      workflowNodeRunId: nodeRun.id,
      createdAt: NOW,
    });

    assertApprovalDecisionAuthorizesOperation({
      request: legacy,
      nodeRun,
      decision: "APPROVED",
      now: LATER,
    });
  });
});
