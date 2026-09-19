import type { JsonValue, WorkflowEventId, WorkspaceId } from "@osva/contracts";

import {
  DomainInvariantError,
  WorkflowEventIdempotencyConflictError,
} from "./errors.js";
import { jsonValuesEqual } from "./json-equality.js";
import { copyCanonicalJsonValue, copyInstant } from "./internals.js";

export interface WorkflowEventCreateProps {
  readonly id: WorkflowEventId;
  readonly workspaceId: WorkspaceId;
  readonly source: string;
  readonly eventType: string;
  readonly correlationKey: string;
  readonly idempotencyKey: string;
  readonly payload: unknown;
  readonly occurredAt?: Date;
  readonly receivedAt: Date;
}

/** Persisted snapshot fields; identical to creation props (no re-derivation). */
export type WorkflowEventRehydrateProps = WorkflowEventCreateProps;

export interface WorkflowEventSubmission {
  readonly workspaceId: WorkspaceId;
  readonly source: string;
  readonly eventType: string;
  readonly correlationKey: string;
  readonly idempotencyKey: string;
  readonly payload: JsonValue;
  readonly occurredAt?: Date;
}

interface WorkflowEventProps {
  readonly id: WorkflowEventId;
  readonly workspaceId: WorkspaceId;
  readonly source: string;
  readonly eventType: string;
  readonly correlationKey: string;
  readonly idempotencyKey: string;
  readonly payload: JsonValue;
  readonly occurredAt: Date | undefined;
  readonly receivedAt: Date;
}

export class WorkflowEvent {
  readonly id: WorkflowEventId;
  readonly workspaceId: WorkspaceId;
  readonly source: string;
  readonly eventType: string;
  readonly correlationKey: string;
  readonly idempotencyKey: string;
  readonly payload: JsonValue;
  readonly occurredAt: Date | undefined;
  readonly receivedAt: Date;

  private constructor(props: WorkflowEventProps) {
    this.id = props.id;
    this.workspaceId = props.workspaceId;
    this.source = props.source;
    this.eventType = props.eventType;
    this.correlationKey = props.correlationKey;
    this.idempotencyKey = props.idempotencyKey;
    this.payload = props.payload;
    this.occurredAt = props.occurredAt;
    this.receivedAt = props.receivedAt;
  }

  static create(props: WorkflowEventCreateProps): WorkflowEvent {
    return WorkflowEvent.instantiate(props);
  }

  static rehydrate(props: WorkflowEventRehydrateProps): WorkflowEvent {
    return WorkflowEvent.instantiate(props);
  }

  private static instantiate(props: WorkflowEventCreateProps): WorkflowEvent {
    if (!props.id) {
      throw new DomainInvariantError("WorkflowEvent.id is required.");
    }

    if (!props.workspaceId) {
      throw new DomainInvariantError("WorkflowEvent.workspaceId is required.");
    }

    const source = requireIdentityString(props.source, "WorkflowEvent.source");
    const eventType = requireIdentityString(
      props.eventType,
      "WorkflowEvent.eventType",
    );
    const correlationKey = requireIdentityString(
      props.correlationKey,
      "WorkflowEvent.correlationKey",
    );
    const idempotencyKey = requireIdentityString(
      props.idempotencyKey,
      "WorkflowEvent.idempotencyKey",
    );

    const payload = copyCanonicalJsonValue(
      props.payload,
      "WorkflowEvent.payload",
    ) as JsonValue;
    const receivedAt = copyInstant(props.receivedAt);
    const occurredAt =
      props.occurredAt === undefined
        ? undefined
        : copyInstant(props.occurredAt);

    const event = new WorkflowEvent({
      id: props.id,
      workspaceId: props.workspaceId,
      source,
      eventType,
      correlationKey,
      idempotencyKey,
      payload,
      occurredAt,
      receivedAt,
    });
    Object.freeze(event);
    return event;
  }
}

export function hasWorkflowEventIngestionIdentity(
  left: Pick<
    WorkflowEvent | WorkflowEventSubmission,
    "workspaceId" | "source" | "idempotencyKey"
  >,
  right: Pick<
    WorkflowEvent | WorkflowEventSubmission,
    "workspaceId" | "source" | "idempotencyKey"
  >,
): boolean {
  return (
    left.workspaceId === right.workspaceId &&
    left.source === right.source &&
    left.idempotencyKey === right.idempotencyKey
  );
}

export function isEquivalentWorkflowEventRetry(
  existing: WorkflowEvent,
  submission: WorkflowEventSubmission,
): boolean {
  if (!hasWorkflowEventIngestionIdentity(existing, submission)) {
    return false;
  }

  if (existing.eventType !== submission.eventType) {
    return false;
  }

  if (existing.correlationKey !== submission.correlationKey) {
    return false;
  }

  if (!jsonValuesEqual(existing.payload, submission.payload)) {
    return false;
  }

  return occurredAtEquivalent(existing.occurredAt, submission.occurredAt);
}

export function assertWorkflowEventEquivalentRetry(
  existing: WorkflowEvent,
  submission: WorkflowEventSubmission,
): void {
  if (
    hasWorkflowEventIngestionIdentity(existing, submission) &&
    !isEquivalentWorkflowEventRetry(existing, submission)
  ) {
    throw new WorkflowEventIdempotencyConflictError(
      existing.workspaceId,
      existing.source,
      existing.idempotencyKey,
    );
  }
}

function occurredAtEquivalent(
  left: Date | undefined,
  right: Date | undefined,
): boolean {
  if (left === undefined && right === undefined) {
    return true;
  }

  if (left === undefined || right === undefined) {
    return false;
  }

  return left.getTime() === right.getTime();
}

function requireIdentityString(value: string, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new DomainInvariantError(`${field} must be a non-empty string.`);
  }

  return value;
}
