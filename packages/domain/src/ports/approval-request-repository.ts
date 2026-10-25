import type {
  ApprovalRequestId,
  ApprovalRequestState,
  WorkflowNodeRunId,
  WorkflowRunId,
  WorkspaceId,
} from "@osva-ai/contracts";

import type { ApprovalRequest } from "../approval-request.js";
import type { SecurityAuditEvent } from "../security-audit-event.js";

export interface ApprovalRequestRepository {
  saveApprovalRequest(request: ApprovalRequest): Promise<void>;
  findApprovalRequestById(
    id: ApprovalRequestId,
  ): Promise<ApprovalRequest | null>;
  findApprovalRequestByWorkspaceAndId(
    workspaceId: WorkspaceId,
    id: ApprovalRequestId,
  ): Promise<ApprovalRequest | null>;
  findApprovalRequestByWorkflowNodeRunId(
    workflowNodeRunId: WorkflowNodeRunId,
  ): Promise<ApprovalRequest | null>;
  listApprovalRequestsByWorkflowRunId(
    workflowRunId: WorkflowRunId,
  ): Promise<readonly ApprovalRequest[]>;
  saveApprovalRequestTransition(
    expectedStatus: ApprovalRequestState,
    next: ApprovalRequest,
  ): Promise<ApprovalRequest>;
  saveApprovalRequestTransitionWithAudit(
    expectedStatus: ApprovalRequestState,
    next: ApprovalRequest,
    auditEvent: SecurityAuditEvent,
  ): Promise<ApprovalRequest>;
}
