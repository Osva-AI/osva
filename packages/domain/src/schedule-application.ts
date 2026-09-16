import type {
  AgentId,
  AgentVersionId,
  JsonValue,
  ScheduleId,
  WorkspaceId,
} from "@osva/contracts";

import {
  AgentNotFoundError,
  AgentVersionNotFoundError,
  DomainInvariantError,
  ScheduleNotFoundError,
  WorkspaceNotFoundError,
} from "./errors.js";
import { Schedule } from "./schedule.js";
import type { AgentRepository } from "./ports/agent-repository.js";
import type {
  ListScheduleOccurrencesQuery,
  ListScheduleOccurrencesResult,
  ListSchedulesQuery,
  ListSchedulesResult,
  ScheduleRepository,
} from "./ports/schedule-repository.js";
import type { WorkspaceRepository } from "./ports/workspace-repository.js";

export interface ScheduleApplicationClock {
  now(): Date;
}

export interface ScheduleApplicationIds {
  createId(): string;
}

export interface ScheduleApplicationDependencies {
  readonly schedules: ScheduleRepository;
  readonly agents: AgentRepository;
  readonly workspaces: WorkspaceRepository;
  readonly clock: ScheduleApplicationClock;
  readonly ids: ScheduleApplicationIds;
}

export interface CreateScheduleCommand {
  readonly workspaceId: WorkspaceId;
  readonly key: string;
  readonly name: string;
  readonly agentId: AgentId;
  readonly agentVersionId: AgentVersionId;
  readonly cronExpression: string;
  readonly timezone: string;
  readonly input: JsonValue;
  readonly enabled?: boolean;
}

export interface UpdateScheduleCommand {
  readonly scheduleId: ScheduleId;
  readonly name?: string;
  readonly agentVersionId?: AgentVersionId;
  readonly cronExpression?: string;
  readonly timezone?: string;
  readonly input?: JsonValue;
  readonly enabled?: boolean;
}

export interface ListScheduleOccurrencesCommand {
  readonly scheduleId: ScheduleId;
  readonly query: ListScheduleOccurrencesQuery;
}

export class CreateSchedule {
  constructor(private readonly deps: ScheduleApplicationDependencies) {}

  async execute(command: CreateScheduleCommand): Promise<Schedule> {
    const workspace = await this.deps.workspaces.findById(command.workspaceId);
    if (workspace === null) {
      throw new WorkspaceNotFoundError(command.workspaceId);
    }

    await assertScheduleAgentOwnership(this.deps.agents, {
      workspaceId: command.workspaceId,
      agentId: command.agentId,
      agentVersionId: command.agentVersionId,
    });

    const schedule = Schedule.create({
      id: this.deps.ids.createId() as ScheduleId,
      workspaceId: command.workspaceId,
      key: command.key,
      name: command.name,
      agentId: command.agentId,
      agentVersionId: command.agentVersionId,
      cronExpression: command.cronExpression,
      timezone: command.timezone,
      input: command.input,
      enabled: command.enabled ?? true,
      now: this.deps.clock.now(),
    });

    await this.deps.schedules.saveSchedule(schedule);
    return schedule;
  }
}

export class GetSchedule {
  constructor(private readonly deps: ScheduleApplicationDependencies) {}

  async execute(scheduleId: ScheduleId): Promise<Schedule> {
    const schedule = await this.deps.schedules.findScheduleById(scheduleId);
    if (schedule === null) {
      throw new ScheduleNotFoundError(scheduleId);
    }

    return schedule;
  }
}

export class ListSchedules {
  constructor(private readonly deps: ScheduleApplicationDependencies) {}

  async execute(query: ListSchedulesQuery): Promise<ListSchedulesResult> {
    return this.deps.schedules.listSchedules(query);
  }
}

export class UpdateSchedule {
  constructor(private readonly deps: ScheduleApplicationDependencies) {}

  async execute(command: UpdateScheduleCommand): Promise<Schedule> {
    const existing = await this.deps.schedules.findScheduleById(
      command.scheduleId,
    );
    if (existing === null) {
      throw new ScheduleNotFoundError(command.scheduleId);
    }

    if (command.agentVersionId !== undefined) {
      await assertScheduleAgentOwnership(this.deps.agents, {
        workspaceId: existing.workspaceId,
        agentId: existing.agentId,
        agentVersionId: command.agentVersionId,
      });
    }

    const updated = existing.update({
      name: command.name,
      agentVersionId: command.agentVersionId,
      cronExpression: command.cronExpression,
      timezone: command.timezone,
      input: command.input,
      enabled: command.enabled,
      now: this.deps.clock.now(),
    });

    await this.deps.schedules.updateSchedule(updated);
    return updated;
  }
}

export class ListScheduleOccurrences {
  constructor(private readonly deps: ScheduleApplicationDependencies) {}

  async execute(
    command: ListScheduleOccurrencesCommand,
  ): Promise<ListScheduleOccurrencesResult> {
    const schedule = await this.deps.schedules.findScheduleById(
      command.scheduleId,
    );
    if (schedule === null) {
      throw new ScheduleNotFoundError(command.scheduleId);
    }

    return this.deps.schedules.listOccurrencesForSchedule({
      scheduleId: command.scheduleId,
      limit: command.query.limit,
      cursor: command.query.cursor,
    });
  }
}

export interface ScheduleApplication {
  readonly createSchedule: CreateSchedule;
  readonly getSchedule: GetSchedule;
  readonly listSchedules: ListSchedules;
  readonly updateSchedule: UpdateSchedule;
  readonly listScheduleOccurrences: ListScheduleOccurrences;
}

export function createScheduleApplication(
  deps: ScheduleApplicationDependencies,
): ScheduleApplication {
  return {
    createSchedule: new CreateSchedule(deps),
    getSchedule: new GetSchedule(deps),
    listSchedules: new ListSchedules(deps),
    updateSchedule: new UpdateSchedule(deps),
    listScheduleOccurrences: new ListScheduleOccurrences(deps),
  };
}

async function assertScheduleAgentOwnership(
  agents: AgentRepository,
  command: {
    readonly workspaceId: WorkspaceId;
    readonly agentId: AgentId;
    readonly agentVersionId: AgentVersionId;
  },
): Promise<void> {
  const agent = await agents.findAgentById(command.agentId);
  if (agent === null) {
    throw new AgentNotFoundError(command.agentId);
  }

  if (agent.workspaceId !== command.workspaceId) {
    throw new DomainInvariantError(
      `Agent ${agent.id} belongs to workspace ${agent.workspaceId}, not ${command.workspaceId}.`,
    );
  }

  const agentVersion = await agents.findAgentVersionById(
    command.agentVersionId,
  );
  if (agentVersion === null) {
    throw new AgentVersionNotFoundError(command.agentVersionId);
  }

  if (agentVersion.agentId !== command.agentId) {
    throw new DomainInvariantError(
      `AgentVersion ${agentVersion.id} belongs to Agent ${agentVersion.agentId}, not ${command.agentId}.`,
    );
  }
}
