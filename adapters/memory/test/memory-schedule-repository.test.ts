import type { RunId, ScheduleId, ScheduleOccurrenceId } from "@osva/contracts";
import {
  DomainInvariantError,
  Schedule,
  nextCronInstantAfter,
} from "@osva/domain";
import { describe, expect, it } from "vitest";

import { MemoryScheduleRepository } from "../src/memory-schedule-repository.js";
import {
  NOW,
  LATER,
  agentId,
  agentVersionId,
  otherAgentVersionId,
  workspaceId,
} from "./fixtures.js";

const scheduleId = "schedule-1" as ScheduleId;
const EVERY_MINUTE = "* * * * *";
const UTC = "UTC";
const SCHEDULE_INPUT = { prompt: "scheduled hello" };

function createEnabledSchedule(
  overrides?: Partial<{
    readonly nextRunAt: Date | null;
    readonly enabled: boolean;
    readonly agentVersionId: typeof agentVersionId;
    readonly input: typeof SCHEDULE_INPUT;
  }>,
): Schedule {
  const enabled = overrides?.enabled ?? true;
  const created = Schedule.create({
    id: scheduleId,
    workspaceId,
    key: "daily-report",
    name: "Daily Report",
    agentId,
    agentVersionId: overrides?.agentVersionId ?? agentVersionId,
    cronExpression: EVERY_MINUTE,
    timezone: UTC,
    input: overrides?.input ?? SCHEDULE_INPUT,
    enabled,
    now: NOW,
  });

  if (overrides?.nextRunAt === undefined) {
    return created;
  }

  return Schedule.rehydrate({
    id: created.id,
    workspaceId: created.workspaceId,
    key: created.key,
    name: created.name,
    agentId: created.agentId,
    agentVersionId: created.agentVersionId,
    cronExpression: created.cronExpression,
    timezone: created.timezone,
    input: created.input,
    enabled: created.enabled,
    nextRunAt: overrides.nextRunAt,
    createdAt: created.createdAt,
    updatedAt: created.updatedAt,
  });
}

describe("MemoryScheduleRepository", () => {
  it("materializes due occurrences and advances nextRunAt atomically", async () => {
    const repository = new MemoryScheduleRepository();
    const schedule = createEnabledSchedule();
    await repository.saveSchedule(schedule);

    const dueAt = schedule.nextRunAt;
    expect(dueAt).not.toBeNull();

    let counter = 0;
    const materialized = await repository.materializeDueOccurrences(
      dueAt!,
      10,
      () => {
        counter += 1;
        return `occ-${String(counter)}` as ScheduleOccurrenceId;
      },
    );

    expect(materialized).toHaveLength(1);
    expect(materialized[0]).toMatchObject({
      scheduleId,
      workspaceId,
      agentId,
      agentVersionId,
      input: SCHEDULE_INPUT,
      scheduledFor: dueAt,
      runId: null,
      dispatchedAt: null,
    });

    const updated = await repository.findScheduleById(scheduleId);
    expect(updated?.nextRunAt).toEqual(
      nextCronInstantAfter(EVERY_MINUTE, UTC, dueAt!),
    );
  });

  it("snapshots execution intent at materialization time", async () => {
    const repository = new MemoryScheduleRepository();
    const schedule = createEnabledSchedule({
      input: { prompt: "first snapshot" },
      agentVersionId,
    });
    await repository.saveSchedule(schedule);

    const dueAt = schedule.nextRunAt!;
    await repository.materializeDueOccurrences(
      dueAt,
      10,
      () => "occ-1" as ScheduleOccurrenceId,
    );

    await repository.updateSchedule(
      (await repository.findScheduleById(scheduleId))!.update({
        input: { prompt: "mutated later" },
        agentVersionId: otherAgentVersionId,
        now: LATER,
      }),
    );

    const listed = await repository.listOccurrencesForSchedule({
      scheduleId,
      limit: 10,
    });
    expect(listed.occurrences).toHaveLength(1);
    expect(listed.occurrences[0]?.input).toEqual({ prompt: "first snapshot" });
    expect(listed.occurrences[0]?.agentVersionId).toBe(agentVersionId);
  });

  it("does not materialize duplicate occurrences for the same scheduledFor", async () => {
    const repository = new MemoryScheduleRepository();
    const schedule = createEnabledSchedule();
    await repository.saveSchedule(schedule);
    const dueAt = schedule.nextRunAt!;

    const first = await repository.materializeDueOccurrences(
      dueAt,
      10,
      () => "occ-1" as ScheduleOccurrenceId,
    );
    expect(first).toHaveLength(1);

    const rewound = Schedule.rehydrate({
      ...(await repository.findScheduleById(scheduleId))!,
      nextRunAt: dueAt,
    });
    await repository.updateSchedule(rewound);

    const second = await repository.materializeDueOccurrences(
      dueAt,
      10,
      () => "occ-2" as ScheduleOccurrenceId,
    );
    expect(second).toHaveLength(0);

    const listed = await repository.listOccurrencesForSchedule({
      scheduleId,
      limit: 10,
    });
    expect(listed.occurrences.map((occurrence) => occurrence.id)).toEqual([
      "occ-1",
    ]);
  });

  it("skips disabled schedules during materialization", async () => {
    const repository = new MemoryScheduleRepository();
    await repository.saveSchedule(createEnabledSchedule({ enabled: false }));

    const materialized = await repository.materializeDueOccurrences(
      LATER,
      10,
      () => "occ-1" as ScheduleOccurrenceId,
    );
    expect(materialized).toHaveLength(0);
  });

  it("applies COALESCE_ONE after scheduler downtime without flooding history", async () => {
    const repository = new MemoryScheduleRepository();
    const overdue = new Date("2026-01-15T11:56:00.000Z");
    const now = new Date("2026-01-15T12:00:00.000Z");
    await repository.saveSchedule(
      createEnabledSchedule({ nextRunAt: overdue }),
    );

    const materialized = await repository.materializeDueOccurrences(
      now,
      100,
      () => "occ-1" as ScheduleOccurrenceId,
    );

    expect(materialized).toHaveLength(1);
    expect(materialized[0]?.scheduledFor).toEqual(overdue);

    const updated = await repository.findScheduleById(scheduleId);
    expect(updated?.nextRunAt).toEqual(
      nextCronInstantAfter(EVERY_MINUTE, UTC, now),
    );
    expect(updated?.nextRunAt?.toISOString()).toBe("2026-01-15T12:01:00.000Z");

    const secondPass = await repository.materializeDueOccurrences(
      now,
      100,
      () => "occ-2" as ScheduleOccurrenceId,
    );
    expect(secondPass).toHaveLength(0);
  });

  it("supports multiple materialize passes as cron instants become due", async () => {
    const repository = new MemoryScheduleRepository();
    await repository.saveSchedule(createEnabledSchedule());

    const firstDue = new Date("2026-01-15T12:01:00.000Z");
    const first = await repository.materializeDueOccurrences(
      firstDue,
      10,
      () => "occ-1" as ScheduleOccurrenceId,
    );
    expect(first).toHaveLength(1);
    expect(first[0]?.scheduledFor.toISOString()).toBe(
      "2026-01-15T12:01:00.000Z",
    );

    const secondDue = new Date("2026-01-15T12:02:00.000Z");
    const second = await repository.materializeDueOccurrences(
      secondDue,
      10,
      () => "occ-2" as ScheduleOccurrenceId,
    );
    expect(second).toHaveLength(1);
    expect(second[0]?.scheduledFor.toISOString()).toBe(
      "2026-01-15T12:02:00.000Z",
    );

    const listed = await repository.listOccurrencesForSchedule({
      scheduleId,
      limit: 10,
    });
    expect(listed.occurrences.map((occurrence) => occurrence.id)).toEqual([
      "occ-2",
      "occ-1",
    ]);
  });

  it("lists undispatched occurrences in scheduledFor order", async () => {
    const repository = new MemoryScheduleRepository();
    await repository.saveSchedule(
      createEnabledSchedule({
        nextRunAt: new Date("2026-01-15T12:01:00.000Z"),
      }),
    );
    await repository.saveSchedule(
      Schedule.rehydrate({
        ...createEnabledSchedule({
          nextRunAt: new Date("2026-01-15T12:02:00.000Z"),
        }),
        id: "schedule-2" as ScheduleId,
        key: "second-report",
      }),
    );

    let counter = 0;
    const materialized = await repository.materializeDueOccurrences(
      new Date("2026-01-15T12:03:00.000Z"),
      10,
      () => {
        counter += 1;
        return `occ-${String(counter)}` as ScheduleOccurrenceId;
      },
    );
    expect(materialized.map((occurrence) => occurrence.id)).toEqual([
      "occ-1",
      "occ-2",
    ]);

    const undispatched = await repository.listUndispatchedOccurrences(10);
    expect(undispatched.map((occurrence) => occurrence.id)).toEqual([
      "occ-1",
      "occ-2",
    ]);
  });

  it("attaches a run id once and rejects conflicting attachments", async () => {
    const repository = new MemoryScheduleRepository();
    const occurrenceId = "occ-1" as ScheduleOccurrenceId;
    const saved = createEnabledSchedule();
    await repository.saveSchedule(saved);
    await repository.materializeDueOccurrences(
      saved.nextRunAt ?? NOW,
      10,
      () => occurrenceId,
    );

    const attached = await repository.attachOccurrenceRunId(
      occurrenceId,
      "run-1" as RunId,
    );
    expect(attached.runId).toBe("run-1");

    await expect(
      repository.attachOccurrenceRunId(occurrenceId, "run-2" as RunId),
    ).rejects.toBeInstanceOf(DomainInvariantError);
  });
});
