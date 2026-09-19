import type {
  WorkflowDefinitionWaitConfigurationV3,
  WorkflowDefinitionWaitCorrelationV3,
  WorkflowEventId,
  WorkflowNodeRunId,
  WorkflowRunId,
  WorkspaceId,
} from "@osva/contracts";
import { isValidUtcIso8601Instant, resolveJsonPointer } from "@osva/contracts";

import {
  DomainInvariantError,
  WorkflowWaitCorrelationResolutionError,
  WorkflowWaitResolutionConflictError,
  WorkflowWaitResolutionNotDueError,
} from "./errors.js";
import type { WorkflowEvent } from "./workflow-event.js";
import { assertWorkflowEventEligibleForWait } from "./workflow-wait-event.js";
import { copyInstant } from "./internals.js";

export type WorkflowWaitKind = "TIMER" | "EVENT";

export type WorkflowWaitResolution =
  "TIMER" | "EVENT" | "TIMEOUT" | "CANCELLED";

export interface ArmWorkflowWaitCommand {
  readonly workspaceId: WorkspaceId;
  readonly workflowRunId: WorkflowRunId;
  readonly workflowNodeRunId: WorkflowNodeRunId;
  readonly workflowRunCreatedAt: Date;
  readonly wait: WorkflowDefinitionWaitConfigurationV3;
  readonly nodeInput: unknown;
  readonly armedAt: Date;
}

/** Persisted frozen WorkflowWait snapshot (no definition re-resolution). */
export interface WorkflowWaitRehydrateProps {
  readonly workspaceId: WorkspaceId;
  readonly workflowRunId: WorkflowRunId;
  readonly workflowNodeRunId: WorkflowNodeRunId;
  readonly kind: WorkflowWaitKind;
  readonly armedAt: Date;
  readonly resolvedAt?: Date;
  readonly resolution?: WorkflowWaitResolution;
  readonly resolvedByEventId?: WorkflowEventId;
  readonly wakeAt?: Date;
  readonly eventSource?: string;
  readonly eventType?: string;
  readonly correlationKey?: string;
  readonly eligibleFrom?: Date;
  readonly expiresAt?: Date;
}

interface WorkflowWaitProps {
  readonly workspaceId: WorkspaceId;
  readonly workflowRunId: WorkflowRunId;
  readonly workflowNodeRunId: WorkflowNodeRunId;
  readonly kind: WorkflowWaitKind;
  readonly armedAt: Date;
  readonly resolvedAt: Date | undefined;
  readonly resolution: WorkflowWaitResolution | undefined;
  readonly resolvedByEventId: WorkflowEventId | undefined;
  readonly wakeAt: Date | undefined;
  readonly eventSource: string | undefined;
  readonly eventType: string | undefined;
  readonly correlationKey: string | undefined;
  readonly eligibleFrom: Date | undefined;
  readonly expiresAt: Date | undefined;
}

export class WorkflowWait {
  readonly workspaceId: WorkspaceId;
  readonly workflowRunId: WorkflowRunId;
  readonly workflowNodeRunId: WorkflowNodeRunId;
  readonly kind: WorkflowWaitKind;
  readonly armedAt: Date;
  readonly resolvedAt: Date | undefined;
  readonly resolution: WorkflowWaitResolution | undefined;
  readonly resolvedByEventId: WorkflowEventId | undefined;
  readonly wakeAt: Date | undefined;
  readonly eventSource: string | undefined;
  readonly eventType: string | undefined;
  readonly correlationKey: string | undefined;
  readonly eligibleFrom: Date | undefined;
  readonly expiresAt: Date | undefined;

  private constructor(props: WorkflowWaitProps) {
    this.workspaceId = props.workspaceId;
    this.workflowRunId = props.workflowRunId;
    this.workflowNodeRunId = props.workflowNodeRunId;
    this.kind = props.kind;
    this.armedAt = props.armedAt;
    this.resolvedAt = props.resolvedAt;
    this.resolution = props.resolution;
    this.resolvedByEventId = props.resolvedByEventId;
    this.wakeAt = props.wakeAt;
    this.eventSource = props.eventSource;
    this.eventType = props.eventType;
    this.correlationKey = props.correlationKey;
    this.eligibleFrom = props.eligibleFrom;
    this.expiresAt = props.expiresAt;
  }

  static rehydrate(props: WorkflowWaitRehydrateProps): WorkflowWait {
    assertWorkflowWaitRehydrationProps(props);
    return WorkflowWait.freeze({
      workspaceId: props.workspaceId,
      workflowRunId: props.workflowRunId,
      workflowNodeRunId: props.workflowNodeRunId,
      kind: props.kind,
      armedAt: props.armedAt,
      resolvedAt: props.resolvedAt,
      resolution: props.resolution,
      resolvedByEventId: props.resolvedByEventId,
      wakeAt: props.wakeAt,
      eventSource: props.eventSource,
      eventType: props.eventType,
      correlationKey: props.correlationKey,
      eligibleFrom: props.eligibleFrom,
      expiresAt: props.expiresAt,
    });
  }

  static arm(command: ArmWorkflowWaitCommand): WorkflowWait {
    const armedAt = copyInstant(command.armedAt);
    const workflowRunCreatedAt = copyInstant(command.workflowRunCreatedAt);
    if (workflowRunCreatedAt.getTime() > armedAt.getTime()) {
      throw new DomainInvariantError(
        "workflowRunCreatedAt cannot be later than armedAt.",
      );
    }

    const wait = command.wait;
    if (wait.kind === "DURATION") {
      const wakeAt = addMilliseconds(armedAt, wait.durationMs);
      if (wakeAt.getTime() <= armedAt.getTime()) {
        throw new DomainInvariantError(
          "DURATION wait wakeAt must be after armedAt.",
        );
      }

      return WorkflowWait.freeze({
        workspaceId: command.workspaceId,
        workflowRunId: command.workflowRunId,
        workflowNodeRunId: command.workflowNodeRunId,
        kind: "TIMER",
        armedAt,
        resolvedAt: undefined,
        resolution: undefined,
        resolvedByEventId: undefined,
        wakeAt,
        eventSource: undefined,
        eventType: undefined,
        correlationKey: undefined,
        eligibleFrom: undefined,
        expiresAt: undefined,
      });
    }

    if (wait.kind === "UNTIL") {
      if (!isValidUtcIso8601Instant(wait.until)) {
        throw new DomainInvariantError(
          "UNTIL wait requires a canonical UTC ISO-8601 instant.",
        );
      }

      const wakeAt = copyInstant(new Date(wait.until));
      return WorkflowWait.freeze({
        workspaceId: command.workspaceId,
        workflowRunId: command.workflowRunId,
        workflowNodeRunId: command.workflowNodeRunId,
        kind: "TIMER",
        armedAt,
        resolvedAt: undefined,
        resolution: undefined,
        resolvedByEventId: undefined,
        wakeAt,
        eventSource: undefined,
        eventType: undefined,
        correlationKey: undefined,
        eligibleFrom: undefined,
        expiresAt: undefined,
      });
    }

    if (wait.kind !== "EVENT") {
      throw new DomainInvariantError("Unsupported WAIT configuration kind.");
    }

    const correlationKey = resolveWaitCorrelationKey(
      wait.correlation,
      command.nodeInput,
    );
    const eligibleFrom = workflowRunCreatedAt;
    const expiresAt =
      wait.timeoutMs === undefined
        ? undefined
        : addMilliseconds(armedAt, wait.timeoutMs);
    if (expiresAt !== undefined && expiresAt.getTime() <= armedAt.getTime()) {
      throw new DomainInvariantError(
        "EVENT wait expiresAt must be after armedAt.",
      );
    }

    return WorkflowWait.freeze({
      workspaceId: command.workspaceId,
      workflowRunId: command.workflowRunId,
      workflowNodeRunId: command.workflowNodeRunId,
      kind: "EVENT",
      armedAt,
      resolvedAt: undefined,
      resolution: undefined,
      resolvedByEventId: undefined,
      wakeAt: undefined,
      eventSource: wait.source,
      eventType: wait.eventType,
      correlationKey,
      eligibleFrom,
      expiresAt,
    });
  }

  isActive(): boolean {
    return this.resolvedAt === undefined;
  }

  isTimerDue(now: Date): boolean {
    if (this.kind !== "TIMER" || this.wakeAt === undefined) {
      return false;
    }

    return copyInstant(now).getTime() >= this.wakeAt.getTime();
  }

  /**
   * True when the EVENT wait's deadline instant has been reached.
   * Does not mean the workflow must fail — a matching event may still win.
   */
  isEventTimeoutDeadlineReached(now: Date): boolean {
    if (this.kind !== "EVENT" || this.expiresAt === undefined) {
      return false;
    }

    return copyInstant(now).getTime() >= this.expiresAt.getTime();
  }

  resolveTimer(now: Date): WorkflowWait {
    if (this.kind !== "TIMER" || this.wakeAt === undefined) {
      throw new DomainInvariantError(
        "Timer resolution applies only to TIMER waits.",
      );
    }

    const at = copyInstant(now);
    if (this.resolution === "TIMER" && this.resolvedAt !== undefined) {
      return this;
    }

    if (this.resolution !== undefined) {
      throw new WorkflowWaitResolutionConflictError(this.resolution, "TIMER");
    }

    if (at.getTime() < this.wakeAt.getTime()) {
      throw new WorkflowWaitResolutionNotDueError("TIMER", this.wakeAt, at);
    }

    assertResolvedAtNotBeforeArmed(this.armedAt, at);
    return this.withResolution("TIMER", at);
  }

  /**
   * Marks an EVENT wait timed out. Caller must first use
   * `decideWorkflowEventWait` (or equivalent) to establish that no eligible
   * WorkflowEvent exists; eligible events always win over timeout.
   */
  resolveTimeout(now: Date): WorkflowWait {
    if (this.kind !== "EVENT" || this.expiresAt === undefined) {
      throw new DomainInvariantError(
        "Timeout resolution applies only to EVENT waits with expiresAt.",
      );
    }

    const at = copyInstant(now);
    if (this.resolution === "TIMEOUT" && this.resolvedAt !== undefined) {
      return this;
    }

    if (this.resolution !== undefined) {
      throw new WorkflowWaitResolutionConflictError(this.resolution, "TIMEOUT");
    }

    if (at.getTime() < this.expiresAt.getTime()) {
      throw new WorkflowWaitResolutionNotDueError(
        "TIMEOUT",
        this.expiresAt,
        at,
      );
    }

    assertResolvedAtNotBeforeArmed(this.armedAt, at);
    return this.withResolution("TIMEOUT", at);
  }

  resolveEvent(event: WorkflowEvent, now: Date): WorkflowWait {
    if (this.kind !== "EVENT") {
      throw new DomainInvariantError(
        "Event resolution applies only to EVENT waits.",
      );
    }

    const at = copyInstant(now);
    if (at.getTime() < this.armedAt.getTime()) {
      throw new DomainInvariantError(
        "Event resolution now cannot be earlier than armedAt.",
      );
    }

    if (
      this.resolution === "EVENT" &&
      this.resolvedAt !== undefined &&
      this.resolvedByEventId === event.id
    ) {
      return this;
    }

    if (this.resolution !== undefined) {
      throw new WorkflowWaitResolutionConflictError(this.resolution, "EVENT");
    }

    assertWorkflowEventEligibleForWait(this, event, at);
    assertResolvedAtNotBeforeArmed(this.armedAt, at);
    return this.withEventResolution(event.id, at);
  }

  cancel(now: Date): WorkflowWait {
    const at = copyInstant(now);
    if (this.resolution === "CANCELLED" && this.resolvedAt !== undefined) {
      return this;
    }

    if (this.resolution !== undefined) {
      throw new WorkflowWaitResolutionConflictError(
        this.resolution,
        "CANCELLED",
      );
    }

    assertResolvedAtNotBeforeArmed(this.armedAt, at);
    return this.withResolution("CANCELLED", at);
  }

  private withResolution(
    resolution: Exclude<WorkflowWaitResolution, "EVENT">,
    resolvedAt: Date,
  ): WorkflowWait {
    return WorkflowWait.freeze({
      workspaceId: this.workspaceId,
      workflowRunId: this.workflowRunId,
      workflowNodeRunId: this.workflowNodeRunId,
      kind: this.kind,
      armedAt: this.armedAt,
      resolvedAt,
      resolution,
      resolvedByEventId: undefined,
      wakeAt: this.wakeAt,
      eventSource: this.eventSource,
      eventType: this.eventType,
      correlationKey: this.correlationKey,
      eligibleFrom: this.eligibleFrom,
      expiresAt: this.expiresAt,
    });
  }

  private withEventResolution(
    resolvedByEventId: WorkflowEventId,
    resolvedAt: Date,
  ): WorkflowWait {
    return WorkflowWait.freeze({
      workspaceId: this.workspaceId,
      workflowRunId: this.workflowRunId,
      workflowNodeRunId: this.workflowNodeRunId,
      kind: this.kind,
      armedAt: this.armedAt,
      resolvedAt,
      resolution: "EVENT",
      resolvedByEventId,
      wakeAt: this.wakeAt,
      eventSource: this.eventSource,
      eventType: this.eventType,
      correlationKey: this.correlationKey,
      eligibleFrom: this.eligibleFrom,
      expiresAt: this.expiresAt,
    });
  }

  private static freeze(props: WorkflowWaitProps): WorkflowWait {
    if (props.resolution === "EVENT" && props.resolvedByEventId === undefined) {
      throw new DomainInvariantError(
        "EVENT resolution requires resolvedByEventId.",
      );
    }

    if (props.resolution !== "EVENT" && props.resolvedByEventId !== undefined) {
      throw new DomainInvariantError(
        "resolvedByEventId is only valid for EVENT resolution.",
      );
    }

    const wait = new WorkflowWait({
      workspaceId: props.workspaceId,
      workflowRunId: props.workflowRunId,
      workflowNodeRunId: props.workflowNodeRunId,
      kind: props.kind,
      armedAt: copyInstant(props.armedAt),
      resolvedAt:
        props.resolvedAt === undefined
          ? undefined
          : copyInstant(props.resolvedAt),
      resolution: props.resolution,
      resolvedByEventId: props.resolvedByEventId,
      wakeAt:
        props.wakeAt === undefined ? undefined : copyInstant(props.wakeAt),
      eventSource: props.eventSource,
      eventType: props.eventType,
      correlationKey: props.correlationKey,
      eligibleFrom:
        props.eligibleFrom === undefined
          ? undefined
          : copyInstant(props.eligibleFrom),
      expiresAt:
        props.expiresAt === undefined
          ? undefined
          : copyInstant(props.expiresAt),
    });
    Object.freeze(wait);
    return wait;
  }
}

export function armWorkflowWait(command: ArmWorkflowWaitCommand): WorkflowWait {
  return WorkflowWait.arm(command);
}

function resolveWaitCorrelationKey(
  correlation: WorkflowDefinitionWaitCorrelationV3,
  nodeInput: unknown,
): string {
  if (correlation.kind === "LITERAL") {
    if (
      typeof correlation.value !== "string" ||
      correlation.value.length === 0
    ) {
      throw new WorkflowWaitCorrelationResolutionError(
        "LITERAL correlation must be a non-empty string.",
      );
    }

    return correlation.value;
  }

  if (correlation.kind !== "INPUT_POINTER") {
    throw new WorkflowWaitCorrelationResolutionError(
      "Unsupported correlation kind.",
    );
  }

  const resolved = resolveJsonPointer(nodeInput, correlation.pointer);
  if (!resolved.found) {
    throw new WorkflowWaitCorrelationResolutionError(
      `JSON Pointer '${correlation.pointer}' did not resolve.`,
    );
  }

  if (typeof resolved.value !== "string") {
    throw new WorkflowWaitCorrelationResolutionError(
      `JSON Pointer '${correlation.pointer}' must resolve to a string.`,
    );
  }

  if (resolved.value.length === 0) {
    throw new WorkflowWaitCorrelationResolutionError(
      `JSON Pointer '${correlation.pointer}' resolved to an empty string.`,
    );
  }

  return resolved.value;
}

function addMilliseconds(base: Date, milliseconds: number): Date {
  if (!Number.isSafeInteger(milliseconds) || milliseconds <= 0) {
    throw new DomainInvariantError(
      "milliseconds must be a positive safe integer.",
    );
  }

  const result = new Date(base.getTime() + milliseconds);
  if (Number.isNaN(result.getTime())) {
    throw new DomainInvariantError(
      "Timestamp arithmetic produced an invalid Date.",
    );
  }

  return result;
}

function assertResolvedAtNotBeforeArmed(armedAt: Date, resolvedAt: Date): void {
  if (resolvedAt.getTime() < armedAt.getTime()) {
    throw new DomainInvariantError(
      "resolvedAt cannot be earlier than armedAt.",
    );
  }
}

function assertWorkflowWaitRehydrationProps(
  props: WorkflowWaitRehydrateProps,
): void {
  if (!props.workspaceId) {
    throw new DomainInvariantError("WorkflowWait.workspaceId is required.");
  }

  if (!props.workflowRunId) {
    throw new DomainInvariantError("WorkflowWait.workflowRunId is required.");
  }

  if (!props.workflowNodeRunId) {
    throw new DomainInvariantError(
      "WorkflowWait.workflowNodeRunId is required.",
    );
  }

  const armedAt = copyInstant(props.armedAt);
  const hasResolvedAt = props.resolvedAt !== undefined;
  const hasResolution = props.resolution !== undefined;
  const hasResolvedByEventId = props.resolvedByEventId !== undefined;

  if (hasResolvedAt !== hasResolution) {
    throw new DomainInvariantError(
      "WorkflowWait resolution and resolvedAt must both be present or both absent.",
    );
  }

  const active = !hasResolution;
  if (active) {
    if (hasResolvedByEventId) {
      throw new DomainInvariantError(
        "Active WorkflowWait cannot contain resolvedByEventId.",
      );
    }
  } else {
    const resolvedAt = copyInstant(props.resolvedAt!);
    assertResolvedAtNotBeforeArmed(armedAt, resolvedAt);

    if (props.resolution === "EVENT") {
      if (!hasResolvedByEventId) {
        throw new DomainInvariantError(
          "EVENT resolution requires resolvedByEventId.",
        );
      }
    } else if (hasResolvedByEventId) {
      throw new DomainInvariantError(
        "resolvedByEventId is only valid for EVENT resolution.",
      );
    }
  }

  if (props.kind === "TIMER") {
    assertTimerWaitRehydration(props, active);
    return;
  }

  if (props.kind === "EVENT") {
    assertEventWaitRehydration(props, armedAt, active);
    return;
  }

  throw new DomainInvariantError("Unsupported WorkflowWait kind.");
}

function assertTimerWaitRehydration(
  props: WorkflowWaitRehydrateProps,
  active: boolean,
): void {
  if (props.wakeAt === undefined) {
    throw new DomainInvariantError("TIMER WorkflowWait requires wakeAt.");
  }

  copyInstant(props.wakeAt);

  if (
    props.eventSource !== undefined ||
    props.eventType !== undefined ||
    props.correlationKey !== undefined ||
    props.eligibleFrom !== undefined ||
    props.expiresAt !== undefined
  ) {
    throw new DomainInvariantError(
      "TIMER WorkflowWait cannot contain EVENT criteria fields.",
    );
  }

  if (!active) {
    const resolution = props.resolution!;
    if (resolution === "EVENT" || resolution === "TIMEOUT") {
      throw new DomainInvariantError(
        `TIMER WorkflowWait cannot have resolution '${resolution}'.`,
      );
    }
  }
}

function assertEventWaitRehydration(
  props: WorkflowWaitRehydrateProps,
  armedAt: Date,
  active: boolean,
): void {
  if (props.wakeAt !== undefined) {
    throw new DomainInvariantError("EVENT WorkflowWait cannot contain wakeAt.");
  }

  requirePersistedIdentityString(props.eventSource, "WorkflowWait.eventSource");
  requirePersistedIdentityString(props.eventType, "WorkflowWait.eventType");
  requirePersistedIdentityString(
    props.correlationKey,
    "WorkflowWait.correlationKey",
  );

  if (props.eligibleFrom === undefined) {
    throw new DomainInvariantError("EVENT WorkflowWait requires eligibleFrom.");
  }

  const eligibleFrom = copyInstant(props.eligibleFrom);
  if (eligibleFrom.getTime() > armedAt.getTime()) {
    throw new DomainInvariantError(
      "EVENT WorkflowWait eligibleFrom cannot be later than armedAt.",
    );
  }

  if (props.expiresAt !== undefined) {
    const expiresAt = copyInstant(props.expiresAt);
    if (expiresAt.getTime() <= armedAt.getTime()) {
      throw new DomainInvariantError(
        "EVENT WorkflowWait expiresAt must be after armedAt.",
      );
    }
  }

  if (!active) {
    const resolution = props.resolution!;
    if (resolution === "TIMER") {
      throw new DomainInvariantError(
        "EVENT WorkflowWait cannot have TIMER resolution.",
      );
    }

    if (resolution === "TIMEOUT" && props.expiresAt === undefined) {
      throw new DomainInvariantError(
        "TIMEOUT resolution requires a persisted expiresAt.",
      );
    }
  }
}

export function hasSameWorkflowWaitArm(
  persisted: WorkflowWait,
  expected: WorkflowWait,
): boolean {
  if (
    persisted.workspaceId !== expected.workspaceId ||
    persisted.workflowRunId !== expected.workflowRunId ||
    persisted.workflowNodeRunId !== expected.workflowNodeRunId ||
    persisted.kind !== expected.kind ||
    persisted.armedAt.getTime() !== expected.armedAt.getTime()
  ) {
    return false;
  }

  if (persisted.kind === "TIMER") {
    return (
      persisted.wakeAt !== undefined &&
      expected.wakeAt !== undefined &&
      persisted.wakeAt.getTime() === expected.wakeAt.getTime()
    );
  }

  return (
    persisted.eventSource === expected.eventSource &&
    persisted.eventType === expected.eventType &&
    persisted.correlationKey === expected.correlationKey &&
    persisted.eligibleFrom !== undefined &&
    expected.eligibleFrom !== undefined &&
    persisted.eligibleFrom.getTime() === expected.eligibleFrom.getTime() &&
    sameOptionalInstant(persisted.expiresAt, expected.expiresAt)
  );
}

function sameOptionalInstant(
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

export function hasSameDurableWorkflowWaitResolution(
  persisted: WorkflowWait,
  attempted: WorkflowWait,
): boolean {
  if (
    persisted.resolution === undefined ||
    attempted.resolution === undefined
  ) {
    return false;
  }

  if (persisted.resolution !== attempted.resolution) {
    return false;
  }

  if (persisted.resolution === "EVENT") {
    return persisted.resolvedByEventId === attempted.resolvedByEventId;
  }

  return true;
}

function requirePersistedIdentityString(
  value: string | undefined,
  field: string,
): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new DomainInvariantError(`${field} must be a non-empty string.`);
  }

  return value;
}
