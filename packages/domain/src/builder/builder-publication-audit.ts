import type {
  SecurityAuditEventId,
  WorkflowId,
  WorkflowVersionId,
  WorkspaceId,
} from "@osva-ai/contracts";
import type { BuilderPublicationId } from "./builder-publication-types.js";
import { SECURITY_AUDIT_EVENT_TYPES } from "@osva-ai/contracts";

import { SecurityAuditEvent } from "../security-audit-event.js";
import { controlPlaneAuditActor } from "../control-plane.js";
import type { ControlPlaneScope } from "../control-plane.js";

export function buildBuilderPublicationSucceededAuditEvent(input: {
  readonly id: SecurityAuditEventId;
  readonly occurredAt: Date;
  readonly scope: ControlPlaneScope;
  readonly workspaceId: WorkspaceId;
  readonly publicationId: BuilderPublicationId;
  readonly workflowId: WorkflowId;
  readonly workflowVersionId: WorkflowVersionId;
  readonly newAgentCount: number;
  readonly reusedAgentCount: number;
}): SecurityAuditEvent {
  const actor = controlPlaneAuditActor(input.scope);
  return SecurityAuditEvent.create({
    id: input.id,
    eventType: SECURITY_AUDIT_EVENT_TYPES.BUILDER_PUBLICATION_SUCCEEDED,
    occurredAt: input.occurredAt,
    workspaceId: input.workspaceId,
    actorUserId: actor.actorUserId,
    details: {
      publicationId: input.publicationId,
      workflowId: input.workflowId,
      workflowVersionId: input.workflowVersionId,
      newAgentCount: input.newAgentCount,
      reusedAgentCount: input.reusedAgentCount,
      subjectId: actor.subjectId,
    },
  });
}
