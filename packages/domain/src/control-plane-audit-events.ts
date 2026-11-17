import type {
  ApiKeyId,
  ApprovalRequestId,
  CommunityEditionRole,
  EvaluationCaseId,
  EvaluationComparisonHumanReviewRevisionId,
  EvaluationComparisonId,
  JsonObject,
  SecurityAuditEventId,
  SecurityAuditEventType,
  UserId,
  WorkflowNodeRunId,
  WorkflowRunId,
  WorkspaceId,
} from "@osva-ai/contracts";
import { SECURITY_AUDIT_EVENT_TYPES } from "@osva-ai/contracts";

import { SecurityAuditEvent } from "./security-audit-event.js";

export function buildApiKeyCreatedAuditEvent(input: {
  readonly id: SecurityAuditEventId;
  readonly occurredAt: Date;
  readonly workspaceId: WorkspaceId;
  readonly actorSubjectId: string;
  readonly apiKeyId: ApiKeyId;
  readonly role: CommunityEditionRole;
}): SecurityAuditEvent {
  return SecurityAuditEvent.create({
    id: input.id,
    eventType: SECURITY_AUDIT_EVENT_TYPES.API_KEY_CREATED,
    occurredAt: input.occurredAt,
    workspaceId: input.workspaceId,
    details: {
      apiKeyId: input.apiKeyId,
      role: input.role,
      subjectId: input.actorSubjectId,
    },
  });
}

export function buildApiKeyRevokedAuditEvent(input: {
  readonly id: SecurityAuditEventId;
  readonly occurredAt: Date;
  readonly workspaceId: WorkspaceId;
  readonly actorSubjectId: string;
  readonly apiKeyId: ApiKeyId;
  readonly role: CommunityEditionRole;
}): SecurityAuditEvent {
  return SecurityAuditEvent.create({
    id: input.id,
    eventType: SECURITY_AUDIT_EVENT_TYPES.API_KEY_REVOKED,
    occurredAt: input.occurredAt,
    workspaceId: input.workspaceId,
    details: {
      apiKeyId: input.apiKeyId,
      role: input.role,
      subjectId: input.actorSubjectId,
    },
  });
}

export function buildApprovalRequestDecidedAuditEvent(input: {
  readonly id: SecurityAuditEventId;
  readonly occurredAt: Date;
  readonly workspaceId: WorkspaceId;
  readonly actorUserId: UserId | undefined;
  readonly actorSubjectId: string;
  readonly approvalRequestId: ApprovalRequestId;
  readonly workflowRunId: WorkflowRunId;
  readonly workflowNodeRunId: WorkflowNodeRunId;
  readonly decision: string;
  readonly detailsExtension?: JsonObject;
}): SecurityAuditEvent {
  return SecurityAuditEvent.create({
    id: input.id,
    eventType: SECURITY_AUDIT_EVENT_TYPES.APPROVAL_REQUEST_DECIDED,
    occurredAt: input.occurredAt,
    workspaceId: input.workspaceId,
    actorUserId: input.actorUserId,
    details: {
      approvalRequestId: input.approvalRequestId,
      workflowRunId: input.workflowRunId,
      workflowNodeRunId: input.workflowNodeRunId,
      decision: input.decision,
      subjectId: input.actorSubjectId,
      ...input.detailsExtension,
    },
  });
}

export function buildEvaluationComparisonHumanReviewSubmittedAuditEvent(input: {
  readonly id: SecurityAuditEventId;
  readonly occurredAt: Date;
  readonly workspaceId: WorkspaceId;
  readonly actorUserId: UserId;
  readonly comparisonId: EvaluationComparisonId;
  readonly evaluationCaseId: EvaluationCaseId;
  readonly revisionId: EvaluationComparisonHumanReviewRevisionId;
  readonly decision: string;
}): SecurityAuditEvent {
  return SecurityAuditEvent.create({
    id: input.id,
    eventType:
      SECURITY_AUDIT_EVENT_TYPES.EVALUATION_COMPARISON_HUMAN_REVIEW_SUBMITTED,
    occurredAt: input.occurredAt,
    workspaceId: input.workspaceId,
    actorUserId: input.actorUserId,
    details: {
      comparisonId: input.comparisonId,
      evaluationCaseId: input.evaluationCaseId,
      revisionId: input.revisionId,
      decision: input.decision,
    },
  });
}

export type { SecurityAuditEventType };
