import type {
  RunAttemptId,
  RunId,
  ScheduleId,
  ScheduleOccurrenceId,
} from "@osva/contracts";
import {
  MemoryAgentRepository,
  MemoryJobQueue,
  MemoryRunRepository,
  MemoryScheduleRepository,
  MemoryWorkspaceRepository,
} from "@osva/adapters-memory";
import { Run, RunAttempt, Schedule } from "@osva/domain";
import { describe, expect, it } from "vitest";

import { CreateRun } from "../src/create-run.js";
import { DispatchScheduleOccurrence } from "../src/dispatch-schedule-occurrence.js";
import { scheduleOccurrenceRunIdempotencyKey } from "../src/schedule-idempotency.js";
import {
  FailingJobQueue,
  LATER,
  NOW,
  RUN_INPUT,
  agentId,
  agentVersionId,
  createBindings,
  runAttemptId,
  runId,
  seedAgentGraph,
  workspaceId,
} from "./fixtures.js";

const scheduleId = "schedule-1" as ScheduleId;
const occurrenceId = "occurrence-1" as ScheduleOccurrenceId;
const scheduledFor = new Date("2026-01-15T12:01:00.000Z");
const otherRunId = "run-2" as RunId;
const otherRunAttemptId = "run-attempt-2" as RunAttemptId;

async function seedDueOccurrence(
  schedules: MemoryScheduleRepository,
): Promise<void> {
  await schedules.saveSchedule(
    Schedule.create({
      id: scheduleId,
      workspaceId,
      key: "daily-report",
      name: "Daily Report",
      agentId,
      agentVersionId,
      cronExpression: "* * * * *",
      timezone: "UTC",
      input: RUN_INPUT,
      enabled: true,
      now: NOW,
    }),
  );
  await schedules.materializeDueOccurrences(
    scheduledFor,
    10,
    () => occurrenceId,
  );
}

async function createDispatch(options?: {
  readonly queue?: MemoryJobQueue | FailingJobQueue;
  readonly runs?: MemoryRunRepository;
  readonly schedules?: MemoryScheduleRepository;
  readonly agents?: MemoryAgentRepository;
}) {
  const workspaces = new MemoryWorkspaceRepository();
  const agents = options?.agents ?? new MemoryAgentRepository();
  const schedules = options?.schedules ?? new MemoryScheduleRepository();
  const runs = options?.runs ?? new MemoryRunRepository();
  const queue = options?.queue ?? new MemoryJobQueue();
  await seedAgentGraph(workspaces, agents);
  await seedDueOccurrence(schedules);

  const createRun = new CreateRun({ runs, agents, queue });
  const dispatch = new DispatchScheduleOccurrence({
    schedules,
    runs,
    createRun,
    queue,
  });

  return { dispatch, schedules, runs, queue, agents };
}

describe("DispatchScheduleOccurrence", () => {
  it("creates a Run with the schedule occurrence idempotency key and enqueues the initial attempt", async () => {
    const { dispatch, runs, queue, schedules } = await createDispatch();
    const occurrence = await schedules.findOccurrenceById(occurrenceId);
    expect(occurrence).not.toBeNull();

    await dispatch.execute({
      occurrence: occurrence!,
      runId,
      runAttemptId,
      now: NOW,
    });

    const idempotencyKey = scheduleOccurrenceRunIdempotencyKey(
      scheduleId,
      scheduledFor,
    );
    const storedRun = await runs.findRunById(runId);
    const storedAttempt = await runs.findRunAttemptById(runAttemptId);
    expect(storedRun).toMatchObject({
      id: runId,
      workspaceId,
      agentId,
      status: "QUEUED",
      input: RUN_INPUT,
      idempotencyKey,
    });
    expect(storedAttempt).toMatchObject({
      id: runAttemptId,
      runId,
      sequence: 1,
      status: "PENDING",
    });
    expect((queue as MemoryJobQueue).pendingRunAttemptIds()).toEqual([
      runAttemptId,
    ]);

    const storedOccurrence = await schedules.findOccurrenceById(occurrenceId);
    expect(storedOccurrence?.runId).toBe(runId);
    expect(storedOccurrence?.dispatchedAt?.toISOString()).toBe(
      NOW.toISOString(),
    );
  });

  it("reuses the same Run and RunAttempt after enqueue failure recovery", async () => {
    const runs = new MemoryRunRepository();
    const schedules = new MemoryScheduleRepository();
    const agents = new MemoryAgentRepository();
    const failingQueue = new FailingJobQueue();
    const { dispatch } = await createDispatch({
      runs,
      schedules,
      agents,
      queue: failingQueue,
    });
    const occurrence = await schedules.findOccurrenceById(occurrenceId);
    expect(occurrence).not.toBeNull();

    await dispatch.execute({
      occurrence: occurrence!,
      runId,
      runAttemptId,
      now: NOW,
    });

    const persistedRun = await runs.findRunById(runId);
    expect(persistedRun?.status).toBe("QUEUED");
    expect(await runs.findRunAttemptById(runAttemptId)).not.toBeNull();

    const undispatched = await schedules.findOccurrenceById(occurrenceId);
    expect(undispatched?.runId).toBe(runId);
    expect(undispatched?.dispatchedAt).toBeNull();

    const workingQueue = new MemoryJobQueue();
    const recovery = new DispatchScheduleOccurrence({
      schedules,
      runs,
      createRun: new CreateRun({ runs, agents, queue: workingQueue }),
      queue: workingQueue,
    });

    await recovery.execute({
      occurrence: undispatched!,
      runId: otherRunId,
      runAttemptId: otherRunAttemptId,
      now: LATER,
    });

    expect(await runs.findRunById(runId)).toMatchObject({ status: "QUEUED" });
    expect(await runs.findRunById(otherRunId)).toBeNull();
    expect(await runs.listRunAttempts(runId)).toHaveLength(1);
    expect(workingQueue.pendingRunAttemptIds()).toEqual([runAttemptId]);
  });

  it("does not enqueue again when the Run is already terminal", async () => {
    const runs = new MemoryRunRepository();
    const queue = new MemoryJobQueue();
    const { dispatch, schedules } = await createDispatch({ runs, queue });
    const occurrence = await schedules.findOccurrenceById(occurrenceId);
    const idempotencyKey = scheduleOccurrenceRunIdempotencyKey(
      scheduleId,
      scheduledFor,
    );

    const terminalRun = Run.rehydrate({
      id: runId,
      workspaceId,
      agentId,
      status: "SUCCEEDED",
      effectiveBindings: createBindings(),
      input: RUN_INPUT,
      createdAt: NOW,
      updatedAt: LATER,
      idempotencyKey,
    });
    const terminalAttempt = RunAttempt.rehydrate({
      id: runAttemptId,
      runId,
      sequence: 1,
      status: "SUCCEEDED",
      createdAt: NOW,
      startedAt: NOW,
      completedAt: LATER,
      output: { ok: true },
    });
    await runs.saveRun(terminalRun);
    await runs.saveRunAttempt(terminalAttempt);

    await dispatch.execute({
      occurrence: occurrence!,
      runId: otherRunId,
      runAttemptId: otherRunAttemptId,
      now: LATER,
    });

    expect(await runs.findRunById(otherRunId)).toBeNull();
    expect(queue.pendingRunAttemptIds()).toEqual([]);
    const storedOccurrence = await schedules.findOccurrenceById(occurrenceId);
    expect(storedOccurrence?.dispatchedAt?.toISOString()).toBe(
      LATER.toISOString(),
    );
  });

  it("does not enqueue again when the Run is already running", async () => {
    const runs = new MemoryRunRepository();
    const queue = new MemoryJobQueue();
    const { dispatch, schedules } = await createDispatch({ runs, queue });
    const occurrence = await schedules.findOccurrenceById(occurrenceId);
    const idempotencyKey = scheduleOccurrenceRunIdempotencyKey(
      scheduleId,
      scheduledFor,
    );

    const pending = Run.create({
      id: runId,
      workspaceId,
      agentId,
      effectiveBindings: createBindings(),
      input: RUN_INPUT,
      createdAt: NOW,
      idempotencyKey,
    });
    await runs.saveRun(pending);
    await runs.saveRunAttempt(
      RunAttempt.createFirst({
        id: runAttemptId,
        runId,
        createdAt: NOW,
      }),
    );
    await runs.transitionRun("PENDING", pending.transitionTo("QUEUED", NOW));
    await runs.transitionRun(
      "QUEUED",
      (await runs.findRunById(runId))!.transitionTo("RUNNING", LATER),
    );

    await dispatch.execute({
      occurrence: occurrence!,
      runId: otherRunId,
      runAttemptId: otherRunAttemptId,
      now: LATER,
    });

    expect(await runs.findRunById(otherRunId)).toBeNull();
    expect(queue.pendingRunAttemptIds()).toEqual([]);
  });

  it("replays dispatch idempotently without creating a second Run", async () => {
    const { dispatch, runs, schedules } = await createDispatch();
    const occurrence = await schedules.findOccurrenceById(occurrenceId);

    await dispatch.execute({
      occurrence: occurrence!,
      runId,
      runAttemptId,
      now: NOW,
    });

    await dispatch.execute({
      occurrence: (await schedules.findOccurrenceById(occurrenceId))!,
      runId: otherRunId,
      runAttemptId: otherRunAttemptId,
      now: LATER,
    });

    const listed = await runs.listRuns({ limit: 10 });
    expect(listed.runs).toHaveLength(1);
    expect(listed.runs[0]?.id).toBe(runId);
    expect(listed.runs[0]?.idempotencyKey).toBe(
      scheduleOccurrenceRunIdempotencyKey(scheduleId, scheduledFor),
    );
  });
});
