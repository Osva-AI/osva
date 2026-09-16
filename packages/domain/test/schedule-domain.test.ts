import type {
  AgentId,
  AgentVersionId,
  JsonValue,
  ScheduleId,
  WorkspaceId,
} from "@osva/contracts";
import { describe, expect, it } from "vitest";

import {
  Agent,
  AgentVersion,
  DomainInvariantError,
  Schedule,
  Workspace,
  assertValidFiveFieldCronExpression,
  assertValidIanaTimezone,
  createScheduleApplication,
  nextCronInstantAfter,
  type AgentRepository,
  type ScheduleRepository,
  type WorkspaceRepository,
} from "../src/index.js";
import {
  NOW,
  LATER,
  agentId,
  agentVersionId,
  createManifest,
  workspaceId,
} from "./fixtures.js";

const otherAgentVersionId = "agent-version-2" as AgentVersionId;

const scheduleId = "schedule-1" as ScheduleId;
const SCHEDULE_INPUT = { prompt: "scheduled hello" };
const EVERY_MINUTE = "* * * * *";
const UTC = "UTC";

function createSchedule(overrides?: {
  readonly enabled?: boolean;
  readonly now?: Date;
  readonly cronExpression?: string;
  readonly timezone?: string;
  readonly input?: JsonValue;
  readonly agentVersionId?: AgentVersionId;
}): Schedule {
  return Schedule.create({
    id: scheduleId,
    workspaceId,
    key: "daily-report",
    name: "Daily Report",
    agentId,
    agentVersionId: overrides?.agentVersionId ?? agentVersionId,
    cronExpression: overrides?.cronExpression ?? EVERY_MINUTE,
    timezone: overrides?.timezone ?? UTC,
    input: overrides?.input ?? SCHEDULE_INPUT,
    enabled: overrides?.enabled ?? true,
    now: overrides?.now ?? NOW,
  });
}

describe("schedule cron validation", () => {
  it("accepts a valid five-field cron expression", () => {
    expect(assertValidFiveFieldCronExpression("0 9 * * *")).toBe("0 9 * * *");
    expect(assertValidFiveFieldCronExpression("  0 9 * * *  ")).toBe(
      "0 9 * * *",
    );
  });

  it("rejects empty cron expressions", () => {
    expect(() => assertValidFiveFieldCronExpression("")).toThrow(
      DomainInvariantError,
    );
    expect(() => assertValidFiveFieldCronExpression("   ")).toThrow(
      /cronExpression is required/,
    );
  });

  it("rejects cron expressions that are not five fields", () => {
    expect(() => assertValidFiveFieldCronExpression("* * * *")).toThrow(
      /five fields/,
    );
    expect(() => assertValidFiveFieldCronExpression("* * * * * *")).toThrow(
      /five fields/,
    );
  });

  it("rejects invalid cron expressions", () => {
    expect(() => assertValidFiveFieldCronExpression("60 0 0 0 0")).toThrow(
      /cronExpression is invalid/,
    );
  });
});

describe("schedule timezone validation", () => {
  it("accepts a valid IANA timezone", () => {
    expect(assertValidIanaTimezone("UTC")).toBe("UTC");
    expect(assertValidIanaTimezone(" America/New_York ")).toBe(
      "America/New_York",
    );
  });

  it("rejects empty timezones", () => {
    expect(() => assertValidIanaTimezone("")).toThrow(DomainInvariantError);
    expect(() => assertValidIanaTimezone("   ")).toThrow(
      /timezone is required/,
    );
  });

  it("rejects invalid IANA timezone names", () => {
    expect(() => assertValidIanaTimezone("Not/A/Timezone")).toThrow(
      /valid IANA name/,
    );
  });
});

describe("Schedule.create", () => {
  it("computes nextRunAt from cron and timezone when enabled", () => {
    const schedule = createSchedule();
    expect(schedule.nextRunAt).toEqual(
      nextCronInstantAfter(EVERY_MINUTE, UTC, NOW),
    );
    expect(schedule.nextRunAt?.toISOString()).toBe("2026-01-15T12:01:00.000Z");
  });

  it("leaves nextRunAt null when disabled at creation", () => {
    const schedule = createSchedule({ enabled: false });
    expect(schedule.enabled).toBe(false);
    expect(schedule.nextRunAt).toBeNull();
  });

  it("stores a cloned canonical input snapshot", () => {
    const schedule = createSchedule({ input: { nested: { value: 1 } } });
    expect(schedule.input).toEqual({ nested: { value: 1 } });
    expect(Object.isFrozen(schedule)).toBe(true);
  });
});

describe("Schedule.update", () => {
  it("clears nextRunAt when disabled and restores it when re-enabled", () => {
    const created = createSchedule();
    const disabled = created.update({ enabled: false, now: LATER });
    expect(disabled.enabled).toBe(false);
    expect(disabled.nextRunAt).toBeNull();

    const reenabled = disabled.update({ enabled: true, now: LATER });
    expect(reenabled.enabled).toBe(true);
    expect(reenabled.nextRunAt).toEqual(
      nextCronInstantAfter(EVERY_MINUTE, UTC, LATER),
    );
  });

  it("recomputes nextRunAt when cron or timezone changes", () => {
    const created = createSchedule();
    const newCron = created.update({
      cronExpression: "0 * * * *",
      now: LATER,
    });
    expect(newCron.cronExpression).toBe("0 * * * *");
    expect(newCron.nextRunAt).toEqual(
      nextCronInstantAfter("0 * * * *", UTC, LATER),
    );

    const newTimezone = created.update({
      timezone: "America/New_York",
      now: LATER,
    });
    expect(newTimezone.timezone).toBe("America/New_York");
    expect(newTimezone.nextRunAt).toEqual(
      nextCronInstantAfter(EVERY_MINUTE, "America/New_York", LATER),
    );
  });

  it("preserves nextRunAt for benign mutations when still enabled", () => {
    const created = createSchedule();
    const renamed = created.update({ name: "Renamed", now: LATER });
    expect(renamed.name).toBe("Renamed");
    expect(renamed.nextRunAt?.toISOString()).toBe(
      created.nextRunAt?.toISOString(),
    );

    const newInput = created.update({
      input: { prompt: "updated" },
      now: LATER,
    });
    expect(newInput.input).toEqual({ prompt: "updated" });
    expect(newInput.nextRunAt?.toISOString()).toBe(
      created.nextRunAt?.toISOString(),
    );

    const newVersion = created.update({
      agentVersionId: otherAgentVersionId,
      now: LATER,
    });
    expect(newVersion.agentVersionId).toBe(otherAgentVersionId);
    expect(newVersion.nextRunAt?.toISOString()).toBe(
      created.nextRunAt?.toISOString(),
    );
  });

  it("rejects invalid cron or timezone during update", () => {
    const created = createSchedule();
    expect(() =>
      created.update({ cronExpression: "60 0 0 0 0", now: LATER }),
    ).toThrow(/cronExpression is invalid/);
    expect(() =>
      created.update({ timezone: "Invalid/Zone", now: LATER }),
    ).toThrow(/valid IANA name/);
  });
});

class FakeWorkspaceRepository implements WorkspaceRepository {
  private readonly items = new Map<WorkspaceId, Workspace>();

  async save(workspace: Workspace): Promise<void> {
    this.items.set(workspace.id, workspace);
  }

  async findById(id: WorkspaceId): Promise<Workspace | null> {
    return this.items.get(id) ?? null;
  }
}

class FakeAgentRepository implements AgentRepository {
  private readonly agents = new Map<AgentId, Agent>();
  private readonly versions = new Map<AgentVersionId, AgentVersion>();

  async saveAgent(agent: Agent): Promise<void> {
    this.agents.set(agent.id, agent);
  }

  async findAgentById(id: AgentId): Promise<Agent | null> {
    return this.agents.get(id) ?? null;
  }

  async listAgents(): Promise<Agent[]> {
    return [...this.agents.values()];
  }

  async updateAgentMetadata(): Promise<Agent> {
    throw new Error("not used");
  }

  async saveAgentVersion(version: AgentVersion): Promise<void> {
    this.versions.set(version.id, version);
  }

  async appendAgentVersion(): Promise<AgentVersion> {
    throw new Error("not used");
  }

  async findAgentVersionById(id: AgentVersionId): Promise<AgentVersion | null> {
    return this.versions.get(id) ?? null;
  }

  async listAgentVersions(agentId: AgentId): Promise<AgentVersion[]> {
    return [...this.versions.values()].filter(
      (version) => version.agentId === agentId,
    );
  }
}

class FakeScheduleRepository implements ScheduleRepository {
  private readonly items = new Map<ScheduleId, Schedule>();

  async saveSchedule(schedule: Schedule): Promise<void> {
    this.items.set(schedule.id, schedule);
  }

  async findScheduleById(id: ScheduleId): Promise<Schedule | null> {
    return this.items.get(id) ?? null;
  }

  async findScheduleByWorkspaceKey(): Promise<Schedule | null> {
    return null;
  }

  async updateSchedule(schedule: Schedule): Promise<void> {
    this.items.set(schedule.id, schedule);
  }

  async listSchedules() {
    return { schedules: [...this.items.values()] };
  }

  async materializeDueOccurrences(): Promise<readonly never[]> {
    return [];
  }

  async listUndispatchedOccurrences(): Promise<readonly never[]> {
    return [];
  }

  async listOccurrencesForSchedule() {
    return { occurrences: [] };
  }

  async findOccurrenceById(): Promise<null> {
    return null;
  }

  async attachOccurrenceRunId(): Promise<never> {
    throw new Error("not used");
  }

  async markOccurrenceDispatched(): Promise<never> {
    throw new Error("not used");
  }
}

describe("schedule application", () => {
  async function createApplication(now: Date = NOW) {
    const workspaces = new FakeWorkspaceRepository();
    const agents = new FakeAgentRepository();
    const schedules = new FakeScheduleRepository();
    await workspaces.save(
      Workspace.create({
        id: workspaceId,
        name: "Workspace",
        createdAt: now,
      }),
    );
    await agents.saveAgent(
      Agent.create({
        id: agentId,
        workspaceId,
        key: "agent-key",
        name: "Example Agent",
        createdAt: now,
      }),
    );
    await agents.saveAgentVersion(
      AgentVersion.create({
        id: agentVersionId,
        agentId,
        version: 1,
        manifest: createManifest(),
        createdAt: now,
      }),
    );
    await agents.saveAgentVersion(
      AgentVersion.create({
        id: otherAgentVersionId,
        agentId,
        version: 2,
        manifest: createManifest({ key: "example-agent-v2" }),
        createdAt: now,
      }),
    );

    let counter = 0;
    return {
      schedules,
      app: createScheduleApplication({
        schedules,
        agents,
        workspaces,
        clock: { now: () => now },
        ids: {
          createId() {
            counter += 1;
            return `schedule-id-${String(counter)}`;
          },
        },
      }),
    };
  }

  it("creates and updates schedules through the application layer", async () => {
    const { app } = await createApplication();
    const created = await app.createSchedule.execute({
      workspaceId,
      key: "daily-report",
      name: "Daily Report",
      agentId,
      agentVersionId,
      cronExpression: EVERY_MINUTE,
      timezone: UTC,
      input: SCHEDULE_INPUT,
    });

    expect(created.nextRunAt).toEqual(
      nextCronInstantAfter(EVERY_MINUTE, UTC, NOW),
    );

    const updated = await app.updateSchedule.execute({
      scheduleId: created.id,
      enabled: false,
    });
    expect(updated.nextRunAt).toBeNull();

    const restored = await app.updateSchedule.execute({
      scheduleId: created.id,
      enabled: true,
      agentVersionId: otherAgentVersionId,
      input: { prompt: "next run" },
      cronExpression: "0 * * * *",
      timezone: "America/Chicago",
    });
    expect(restored.agentVersionId).toBe(otherAgentVersionId);
    expect(restored.input).toEqual({ prompt: "next run" });
    expect(restored.nextRunAt).toEqual(
      nextCronInstantAfter("0 * * * *", "America/Chicago", NOW),
    );
  });
});
