import type {
  AgentId,
  AgentVersionId,
  JsonValue,
  RunId,
  ScheduleId,
  ScheduleOccurrenceId,
  WorkspaceId,
} from "@osva/contracts";
import { isCanonicalJsonValue } from "@osva/contracts";

import { DomainInvariantError } from "./errors.js";
import { copyCanonicalJsonValue, copyInstant } from "./internals.js";

export interface ScheduleOccurrenceProps {
  readonly id: ScheduleOccurrenceId;
  readonly scheduleId: ScheduleId;
  readonly workspaceId: WorkspaceId;
  readonly agentId: AgentId;
  readonly agentVersionId: AgentVersionId;
  readonly input: JsonValue;
  readonly scheduledFor: Date;
  readonly runId: RunId | null;
  readonly createdAt: Date;
  readonly dispatchedAt: Date | null;
}

export interface CreateScheduleOccurrenceProps {
  readonly id: ScheduleOccurrenceId;
  readonly scheduleId: ScheduleId;
  readonly workspaceId: WorkspaceId;
  readonly agentId: AgentId;
  readonly agentVersionId: AgentVersionId;
  readonly input: JsonValue;
  readonly scheduledFor: Date;
  readonly createdAt: Date;
}

export class ScheduleOccurrence {
  readonly id: ScheduleOccurrenceId;
  readonly scheduleId: ScheduleId;
  readonly workspaceId: WorkspaceId;
  readonly agentId: AgentId;
  readonly agentVersionId: AgentVersionId;
  readonly input: JsonValue;
  readonly scheduledFor: Date;
  readonly runId: RunId | null;
  readonly createdAt: Date;
  readonly dispatchedAt: Date | null;

  private constructor(props: ScheduleOccurrenceProps) {
    this.id = props.id;
    this.scheduleId = props.scheduleId;
    this.workspaceId = props.workspaceId;
    this.agentId = props.agentId;
    this.agentVersionId = props.agentVersionId;
    this.input = props.input;
    this.scheduledFor = props.scheduledFor;
    this.runId = props.runId;
    this.createdAt = props.createdAt;
    this.dispatchedAt = props.dispatchedAt;
  }

  static create(props: CreateScheduleOccurrenceProps): ScheduleOccurrence {
    if (!props.id) {
      throw new DomainInvariantError("ScheduleOccurrence.id is required.");
    }

    if (!props.scheduleId) {
      throw new DomainInvariantError(
        "ScheduleOccurrence.scheduleId is required.",
      );
    }

    return Object.freeze(
      new ScheduleOccurrence({
        id: props.id,
        scheduleId: props.scheduleId,
        workspaceId: props.workspaceId,
        agentId: props.agentId,
        agentVersionId: props.agentVersionId,
        input: copyCanonicalJsonValue(
          props.input,
          "ScheduleOccurrence.input",
        ) as JsonValue,
        scheduledFor: copyInstant(props.scheduledFor),
        runId: null,
        createdAt: copyInstant(props.createdAt),
        dispatchedAt: null,
      }),
    );
  }

  static rehydrate(props: ScheduleOccurrenceProps): ScheduleOccurrence {
    if (!isCanonicalJsonValue(props.input)) {
      throw new DomainInvariantError(
        "ScheduleOccurrence.input must be JSON-compatible.",
      );
    }

    return Object.freeze(
      new ScheduleOccurrence({
        id: props.id,
        scheduleId: props.scheduleId,
        workspaceId: props.workspaceId,
        agentId: props.agentId,
        agentVersionId: props.agentVersionId,
        input: props.input,
        scheduledFor: copyInstant(props.scheduledFor),
        runId: props.runId,
        createdAt: copyInstant(props.createdAt),
        dispatchedAt:
          props.dispatchedAt === null ? null : copyInstant(props.dispatchedAt),
      }),
    );
  }

  withRunId(runId: RunId): ScheduleOccurrence {
    if (!runId) {
      throw new DomainInvariantError("ScheduleOccurrence.runId is required.");
    }

    return ScheduleOccurrence.rehydrate({
      id: this.id,
      scheduleId: this.scheduleId,
      workspaceId: this.workspaceId,
      agentId: this.agentId,
      agentVersionId: this.agentVersionId,
      input: this.input,
      scheduledFor: this.scheduledFor,
      runId,
      createdAt: this.createdAt,
      dispatchedAt: this.dispatchedAt,
    });
  }

  withDispatchedAt(dispatchedAt: Date): ScheduleOccurrence {
    return ScheduleOccurrence.rehydrate({
      id: this.id,
      scheduleId: this.scheduleId,
      workspaceId: this.workspaceId,
      agentId: this.agentId,
      agentVersionId: this.agentVersionId,
      input: this.input,
      scheduledFor: this.scheduledFor,
      runId: this.runId,
      createdAt: this.createdAt,
      dispatchedAt: copyInstant(dispatchedAt),
    });
  }
}
