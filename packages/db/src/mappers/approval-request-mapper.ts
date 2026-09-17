import type {
  ApprovalRequestId,
  ApprovalRequestState,
  WorkflowNodeRunId,
  WorkflowRunId,
  WorkspaceId,
} from "@osva/contracts";
import { ApprovalRequest } from "@osva/domain";

import type { approvalRequests } from "../schema/approval-requests.js";
import { toDomainDate, toOptionalDomainDate } from "./timestamps.js";

type ApprovalRequestRow = typeof approvalRequests.$inferSelect;

export function approvalRequestToRow(request: ApprovalRequest) {
  return {
    id: request.id,
    workspaceId: request.workspaceId,
    workflowRunId: request.workflowRunId,
    workflowNodeRunId: request.workflowNodeRunId,
    status: request.status,
    decisionComment: request.decisionComment ?? null,
    decidedAt: request.decidedAt ?? null,
    createdAt: request.createdAt,
    updatedAt: request.updatedAt,
  };
}

export function approvalRequestFromRow(
  row: ApprovalRequestRow,
): ApprovalRequest {
  return ApprovalRequest.rehydrate({
    id: row.id as ApprovalRequestId,
    workspaceId: row.workspaceId as WorkspaceId,
    workflowRunId: row.workflowRunId as WorkflowRunId,
    workflowNodeRunId: row.workflowNodeRunId as WorkflowNodeRunId,
    status: row.status as ApprovalRequestState,
    decisionComment: row.decisionComment ?? undefined,
    decidedAt: toOptionalDomainDate(row.decidedAt),
    createdAt: toDomainDate(row.createdAt),
    updatedAt: toDomainDate(row.updatedAt),
  });
}
