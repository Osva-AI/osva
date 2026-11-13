import type {
  ApprovalRequestId,
  ArtifactId,
  AssignmentId,
  OfficeMessageId,
  OfficeThreadId,
  RunId,
  WorkflowNodeRunId,
  WorkflowRunId,
  WorkspaceId,
} from "@osva-ai/contracts";
import { describe, expect, it } from "vitest";

import { ApprovalRequest } from "../src/approval-request.js";
import { Artifact } from "../src/artifact.js";
import { Assignment } from "../src/assignment.js";
import { OfficeMessage } from "../src/office-message.js";
import {
  buildApprovalInboxItem,
  buildAssignmentInboxItem,
  buildDeliverableInboxItem,
  inboxItemIdForApproval,
  paginateInboxItems,
  parseOperationalInboxItemId,
  sortInboxItemsDescending,
} from "../src/office-inbox-projection.js";

const WORKSPACE = "ws-1" as WorkspaceId;
const NOW = new Date("2026-03-15T12:00:00.000Z");
const LATER = new Date("2026-03-15T13:00:00.000Z");

describe("office inbox projection", () => {
  it("builds stable approval and assignment item ids", () => {
    const approvalId = "appr-1" as ApprovalRequestId;
    expect(inboxItemIdForApproval(approvalId)).toBe("approval:appr-1");

    const pending = ApprovalRequest.create({
      id: approvalId,
      workspaceId: WORKSPACE,
      workflowRunId: "wfr-1" as WorkflowRunId,
      workflowNodeRunId: "wnr-1" as WorkflowNodeRunId,
      createdAt: NOW,
    });
    const item = buildApprovalInboxItem(pending);
    const withAssignment = buildApprovalInboxItem(pending, {
      assignmentId: "asn-1" as never,
    });
    expect(withAssignment.assignmentId).toBe("asn-1");
    expect(item.kind).toBe("APPROVAL_PENDING");
    expect(item.workflowRunId).toBe("wfr-1");
  });

  it("only surfaces failed or cancelled assignments", () => {
    const failed = Assignment.rehydrate({
      id: "asn-1" as AssignmentId,
      workspaceId: WORKSPACE,
      officeWorkerId: "ow-1" as never,
      title: "Research",
      targetType: "AGENT_VERSION",
      targetVersionId: "av-1",
      input: {},
      status: "FAILED",
      createdAt: NOW,
      completedAt: LATER,
    });
    expect(buildAssignmentInboxItem(failed)?.kind).toBe("ASSIGNMENT_UPDATE");

    const running = Assignment.rehydrate({
      id: "asn-1" as AssignmentId,
      workspaceId: WORKSPACE,
      officeWorkerId: "ow-1" as never,
      title: "Research",
      targetType: "AGENT_VERSION",
      targetVersionId: "av-1",
      input: {},
      status: "RUNNING",
      createdAt: NOW,
    });
    expect(buildAssignmentInboxItem(running)).toBeNull();
  });

  it("sorts and paginates deterministically", () => {
    const message = OfficeMessage.rehydrate({
      id: "msg-1" as OfficeMessageId,
      workspaceId: WORKSPACE,
      threadId: "thr-1" as OfficeThreadId,
      sequence: 1,
      authorType: "HUMAN",
      authorUserId: "user-a" as never,
      body: "Hello",
      parentMessageId: undefined,
      mentions: [],
      references: [],
      idempotencyKey: undefined,
      createdAt: NOW,
    });
    const approval = buildApprovalInboxItem(
      ApprovalRequest.create({
        id: "appr-2" as ApprovalRequestId,
        workspaceId: WORKSPACE,
        workflowRunId: "wfr-2" as WorkflowRunId,
        workflowNodeRunId: "wnr-2" as WorkflowNodeRunId,
        createdAt: LATER,
      }),
    );
    const sorted = sortInboxItemsDescending([
      {
        id: `chat:${message.id}`,
        kind: "CHAT_MESSAGE",
        occurredAt: message.createdAt.toISOString(),
        unread: true,
        title: "General",
        threadId: message.threadId,
        messageId: message.id,
      },
      approval,
    ]);
    expect(sorted[0]?.id).toBe(approval.id);

    const page = paginateInboxItems({
      items: sorted,
      limit: 1,
    });
    expect(page.items).toHaveLength(1);
    expect(page.nextCursor?.id).toBe(approval.id);
  });

  it("parses operational inbox item ids", () => {
    expect(parseOperationalInboxItemId("approval:appr-1")?.kind).toBe(
      "approval",
    );
    const assignmentParsed = parseOperationalInboxItemId(
      "assignment:asn-1:FAILED",
    );
    if (assignmentParsed?.kind !== "assignment") {
      throw new Error("expected assignment inbox item id");
    }
    expect(assignmentParsed.status).toBe("FAILED");
    expect(parseOperationalInboxItemId("chat:msg-1")).toBeNull();
  });

  it("maps deliverables from completed assignment runs", () => {
    const artifact = Artifact.create({
      id: "art-1" as ArtifactId,
      workspaceId: WORKSPACE,
      name: "report.md",
      mediaType: "text/markdown",
      sizeBytes: 12,
      digest: `sha256:${"a".repeat(64)}`,
      metadata: {},
      producerRunId: "run-1" as RunId,
      producerRunAttemptId: "ra-1" as never,
      createdAt: LATER,
    });
    const item = buildDeliverableInboxItem({
      artifact,
      assignmentId: "asn-2" as AssignmentId,
      assignmentTitle: "Write report",
      runId: "run-1" as RunId,
    });
    expect(item.kind).toBe("DELIVERABLE_READY");
    expect(item.artifactId).toBe("art-1");
  });
});
