import type {
  AgentId,
  AgentVersionId,
  JsonValue,
  ScheduleId,
  WorkspaceId,
} from "@osva/contracts";
import { isCanonicalJsonValue } from "@osva/contracts";

import { DomainInvariantError } from "./errors.js";
import {
  assertValidFiveFieldCronExpression,
  assertValidIanaTimezone,
  nextCronInstantAfter,
} from "./schedule-cron.js";
import {
  copyCanonicalJsonValue,
  copyInstant,
  requireNonEmptyString,
} from "./internals.js";

export interface ScheduleProps {
  readonly id: ScheduleId;
  readonly workspaceId: WorkspaceId;
  readonly key: string;
  readonly name: string;
  readonly agentId: AgentId;
  readonly agentVersionId: AgentVersionId;
  readonly cronExpression: string;
  readonly timezone: string;
  readonly input: JsonValue;
  readonly enabled: boolean;
  readonly nextRunAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface CreateScheduleProps {
  readonly id: ScheduleId;
  readonly workspaceId: WorkspaceId;
  readonly key: string;
  readonly name: string;
  readonly agentId: AgentId;
  readonly agentVersionId: AgentVersionId;
  readonly cronExpression: string;
  readonly timezone: string;
  readonly input: JsonValue;
  readonly enabled: boolean;
  readonly now: Date;
}

export interface UpdateScheduleProps {
  readonly name?: string;
  readonly agentVersionId?: AgentVersionId;
  readonly cronExpression?: string;
  readonly timezone?: string;
  readonly input?: JsonValue;
  readonly enabled?: boolean;
  readonly now: Date;
}

export class Schedule {
  readonly id: ScheduleId;
  readonly workspaceId: WorkspaceId;
  readonly key: string;
  readonly name: string;
  readonly agentId: AgentId;
  readonly agentVersionId: AgentVersionId;
  readonly cronExpression: string;
  readonly timezone: string;
  readonly input: JsonValue;
  readonly enabled: boolean;
  readonly nextRunAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;

  private constructor(props: ScheduleProps) {
    this.id = props.id;
    this.workspaceId = props.workspaceId;
    this.key = props.key;
    this.name = props.name;
    this.agentId = props.agentId;
    this.agentVersionId = props.agentVersionId;
    this.cronExpression = props.cronExpression;
    this.timezone = props.timezone;
    this.input = props.input;
    this.enabled = props.enabled;
    this.nextRunAt = props.nextRunAt;
    this.createdAt = props.createdAt;
    this.updatedAt = props.updatedAt;
  }

  static create(props: CreateScheduleProps): Schedule {
    if (!props.id) {
      throw new DomainInvariantError("Schedule.id is required.");
    }

    if (!props.workspaceId) {
      throw new DomainInvariantError("Schedule.workspaceId is required.");
    }

    if (!props.agentId) {
      throw new DomainInvariantError("Schedule.agentId is required.");
    }

    if (!props.agentVersionId) {
      throw new DomainInvariantError("Schedule.agentVersionId is required.");
    }

    const cronExpression = assertValidFiveFieldCronExpression(
      props.cronExpression,
    );
    const timezone = assertValidIanaTimezone(props.timezone);
    const input = copyCanonicalJsonValue(
      props.input,
      "Schedule.input",
    ) as JsonValue;
    const now = copyInstant(props.now);
    const enabled = props.enabled;
    const nextRunAt = enabled
      ? nextCronInstantAfter(cronExpression, timezone, now)
      : null;

    return Object.freeze(
      new Schedule({
        id: props.id,
        workspaceId: props.workspaceId,
        key: requireNonEmptyString(props.key, "Schedule.key"),
        name: requireNonEmptyString(props.name, "Schedule.name"),
        agentId: props.agentId,
        agentVersionId: props.agentVersionId,
        cronExpression,
        timezone,
        input,
        enabled,
        nextRunAt,
        createdAt: now,
        updatedAt: now,
      }),
    );
  }

  static rehydrate(props: ScheduleProps): Schedule {
    if (!isCanonicalJsonValue(props.input)) {
      throw new DomainInvariantError("Schedule.input must be JSON-compatible.");
    }

    return Object.freeze(
      new Schedule({
        id: props.id,
        workspaceId: props.workspaceId,
        key: props.key,
        name: props.name,
        agentId: props.agentId,
        agentVersionId: props.agentVersionId,
        cronExpression: props.cronExpression,
        timezone: props.timezone,
        input: props.input,
        enabled: props.enabled,
        nextRunAt:
          props.nextRunAt === null ? null : copyInstant(props.nextRunAt),
        createdAt: copyInstant(props.createdAt),
        updatedAt: copyInstant(props.updatedAt),
      }),
    );
  }

  update(props: UpdateScheduleProps): Schedule {
    const name =
      props.name === undefined
        ? this.name
        : requireNonEmptyString(props.name, "Schedule.name");
    const agentVersionId = props.agentVersionId ?? this.agentVersionId;
    const cronExpression =
      props.cronExpression === undefined
        ? this.cronExpression
        : assertValidFiveFieldCronExpression(props.cronExpression);
    const timezone =
      props.timezone === undefined
        ? this.timezone
        : assertValidIanaTimezone(props.timezone);
    const input: JsonValue =
      props.input === undefined
        ? this.input
        : (copyCanonicalJsonValue(props.input, "Schedule.input") as JsonValue);
    const enabled = props.enabled ?? this.enabled;
    const now = copyInstant(props.now);

    let nextRunAt: Date | null;
    if (!enabled) {
      nextRunAt = null;
    } else if (
      props.enabled === true ||
      props.cronExpression !== undefined ||
      props.timezone !== undefined
    ) {
      nextRunAt = nextCronInstantAfter(cronExpression, timezone, now);
    } else {
      nextRunAt = this.nextRunAt === null ? null : copyInstant(this.nextRunAt);
    }

    return Schedule.rehydrate({
      id: this.id,
      workspaceId: this.workspaceId,
      key: this.key,
      name,
      agentId: this.agentId,
      agentVersionId,
      cronExpression,
      timezone,
      input,
      enabled,
      nextRunAt,
      createdAt: this.createdAt,
      updatedAt: now,
    });
  }
}
