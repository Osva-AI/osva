import type { WorkflowEventId } from "@osva/contracts";

import {
  DomainInvariantError,
  WorkflowWaitEventNotEligibleError,
} from "./errors.js";
import { copyInstant } from "./internals.js";
import type { WorkflowEvent } from "./workflow-event.js";
import type { WorkflowWait } from "./workflow-wait.js";

export type WorkflowEventWaitDecision =
  | { readonly kind: "EVENT"; readonly event: WorkflowEvent }
  | { readonly kind: "TIMEOUT" }
  | { readonly kind: "PENDING" };

export function matchesWorkflowEventWait(
  wait: WorkflowWait,
  event: WorkflowEvent,
): boolean {
  if (wait.kind !== "EVENT") {
    return false;
  }

  return (
    wait.workspaceId === event.workspaceId &&
    wait.eventSource === event.source &&
    wait.eventType === event.eventType &&
    wait.correlationKey === event.correlationKey
  );
}

export function isWorkflowEventEligibleForWait(
  wait: WorkflowWait,
  event: WorkflowEvent,
  now: Date,
): boolean {
  if (!matchesWorkflowEventWait(wait, event)) {
    return false;
  }

  if (wait.eligibleFrom === undefined) {
    return false;
  }

  const receivedAt = event.receivedAt.getTime();
  const decisionNow = copyInstant(now).getTime();
  const eligibleFrom = wait.eligibleFrom.getTime();

  if (receivedAt < eligibleFrom) {
    return false;
  }

  if (receivedAt > decisionNow) {
    return false;
  }

  if (wait.expiresAt !== undefined && receivedAt > wait.expiresAt.getTime()) {
    return false;
  }

  return true;
}

export function assertWorkflowEventEligibleForWait(
  wait: WorkflowWait,
  event: WorkflowEvent,
  now: Date,
): void {
  if (!isWorkflowEventEligibleForWait(wait, event, now)) {
    throw new WorkflowWaitEventNotEligibleError(
      wait.workflowNodeRunId,
      event.id,
    );
  }
}

export function selectWorkflowEventForWait(
  wait: WorkflowWait,
  events: readonly WorkflowEvent[],
  now: Date,
): WorkflowEvent | null {
  const eligible = events.filter((event) =>
    isWorkflowEventEligibleForWait(wait, event, now),
  );

  if (eligible.length === 0) {
    return null;
  }

  const sorted = [...eligible].sort(compareWorkflowEventsForWaitSelection);
  return sorted[0] ?? null;
}

export function decideWorkflowEventWait(
  wait: WorkflowWait,
  events: readonly WorkflowEvent[],
  now: Date,
): WorkflowEventWaitDecision {
  if (!wait.isActive()) {
    throw new DomainInvariantError(
      "Cannot decide event wait outcome for a resolved WorkflowWait.",
    );
  }

  if (wait.kind !== "EVENT") {
    throw new DomainInvariantError(
      "Event wait decisions apply only to EVENT WorkflowWait instances.",
    );
  }

  const at = copyInstant(now);
  const selected = selectWorkflowEventForWait(wait, events, at);
  if (selected !== null) {
    return { kind: "EVENT", event: selected };
  }

  if (
    wait.expiresAt !== undefined &&
    at.getTime() >= wait.expiresAt.getTime()
  ) {
    return { kind: "TIMEOUT" };
  }

  return { kind: "PENDING" };
}

function compareWorkflowEventsForWaitSelection(
  left: WorkflowEvent,
  right: WorkflowEvent,
): number {
  const receivedDelta = left.receivedAt.getTime() - right.receivedAt.getTime();
  if (receivedDelta !== 0) {
    return receivedDelta;
  }

  return compareWorkflowEventIds(left.id, right.id);
}

function compareWorkflowEventIds(
  left: WorkflowEventId,
  right: WorkflowEventId,
): number {
  if (left < right) {
    return -1;
  }

  if (left > right) {
    return 1;
  }

  return 0;
}
