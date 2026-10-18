import type {
  JsonObject,
  OrganizationId,
  SecurityAuditEventId,
  UserId,
  WorkspaceId,
} from "@osva-ai/contracts";
import type { SecurityAuditEventType } from "@osva-ai/contracts";
import {
  SECURITY_AUDIT_EVENT_DETAILS_MAX_BYTES,
  isCanonicalJsonValue,
} from "@osva-ai/contracts";

import { DomainInvariantError } from "./errors.js";
import { copyInstant } from "./internals.js";

export interface SecurityAuditEventProps {
  readonly id: SecurityAuditEventId;
  readonly eventType: SecurityAuditEventType;
  readonly occurredAt: Date;
  readonly organizationId?: OrganizationId;
  readonly workspaceId?: WorkspaceId;
  readonly actorUserId?: UserId;
  readonly details: JsonObject;
}

export class SecurityAuditEvent {
  readonly id: SecurityAuditEventId;
  readonly eventType: SecurityAuditEventType;
  readonly occurredAt: Date;
  readonly organizationId: OrganizationId | undefined;
  readonly workspaceId: WorkspaceId | undefined;
  readonly actorUserId: UserId | undefined;
  readonly details: JsonObject;

  private constructor(props: SecurityAuditEventProps) {
    this.id = props.id;
    this.eventType = props.eventType;
    this.occurredAt = props.occurredAt;
    this.organizationId = props.organizationId;
    this.workspaceId = props.workspaceId;
    this.actorUserId = props.actorUserId;
    this.details = props.details;
  }

  static create(props: SecurityAuditEventProps): SecurityAuditEvent {
    if (!props.id) {
      throw new DomainInvariantError("SecurityAuditEvent.id is required.");
    }

    if (!isCanonicalJsonValue(props.details)) {
      throw new DomainInvariantError(
        "SecurityAuditEvent.details must be JSON-compatible.",
      );
    }

    const detailsBytes = Buffer.byteLength(
      JSON.stringify(props.details),
      "utf8",
    );
    if (detailsBytes > SECURITY_AUDIT_EVENT_DETAILS_MAX_BYTES) {
      throw new DomainInvariantError(
        `SecurityAuditEvent.details must be at most ${String(SECURITY_AUDIT_EVENT_DETAILS_MAX_BYTES)} bytes.`,
      );
    }

    return Object.freeze(
      new SecurityAuditEvent({
        id: props.id,
        eventType: props.eventType,
        occurredAt: copyInstant(props.occurredAt),
        organizationId: props.organizationId,
        workspaceId: props.workspaceId,
        actorUserId: props.actorUserId,
        details: props.details,
      }),
    );
  }
}
