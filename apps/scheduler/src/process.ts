import { randomUUID } from "node:crypto";

import { BullMqJobQueue, type PingableJobQueue } from "@osva/adapters-bullmq";
import { createOpenTelemetryLifecycle } from "@osva/adapters-opentelemetry";
import type {
  RunAttemptId,
  RunId,
  ScheduleOccurrenceId,
} from "@osva/contracts";
import {
  checkDatabaseConnection,
  createDatabase,
  PostgresAgentRepository,
  PostgresRunRepository,
  PostgresScheduleRepository,
  type Database,
} from "@osva/db";
import {
  CreateRun,
  DispatchScheduleOccurrence,
  SchedulerTick,
} from "@osva/orchestration";

import { loadSchedulerConfig, type SchedulerConfig } from "./config.js";
import { logError, logEvent } from "./log.js";
import {
  createSchedulerApplication,
  type SchedulerApplication,
  type SchedulerStatus,
} from "./scheduler.js";

export interface SchedulerProcess {
  readonly config: SchedulerConfig;
  start(): Promise<void>;
  stop(): Promise<void>;
  tickOnce(): Promise<void>;
  status(): SchedulerStatus;
}

export interface SchedulerProcessDependencies {
  readonly databaseFactory?: (connectionString: string) => Database;
  readonly queueFactory?: (valkeyUrl: string) => PingableJobQueue;
  readonly clock?: { now(): Date };
}

export function createSchedulerProcess(
  env: NodeJS.ProcessEnv = process.env,
  databaseFactory: (connectionString: string) => Database = (
    connectionString,
  ) => createDatabase({ connectionString }),
  dependencies: SchedulerProcessDependencies = {},
): SchedulerProcess {
  const config = loadSchedulerConfig(env);
  const telemetryLifecycle = createOpenTelemetryLifecycle(env);
  const instrumentation = telemetryLifecycle.instrumentation;
  const createDatabaseHandle = dependencies.databaseFactory ?? databaseFactory;
  const createQueue =
    dependencies.queueFactory ??
    ((valkeyUrl: string) =>
      new BullMqJobQueue({
        url: valkeyUrl,
        instrumentation,
        logger: {
          info: logEvent,
          error: logError,
        },
      }));
  const database = createDatabaseHandle(config.databaseUrl);
  const queue = createQueue(config.valkeyUrl);
  const clock = dependencies.clock ?? { now: () => new Date() };
  const runs = new PostgresRunRepository(database);
  const schedules = new PostgresScheduleRepository(database);
  const agents = new PostgresAgentRepository(database);
  const createRun = new CreateRun({ runs, agents, queue, instrumentation });
  const dispatch = new DispatchScheduleOccurrence({
    schedules,
    runs,
    createRun,
    queue,
    instrumentation,
    logger: {
      info: logEvent,
      error: logError,
    },
  });
  const tick = new SchedulerTick({
    schedules,
    dispatch,
    instrumentation,
    logger: {
      info: logEvent,
      error: logError,
    },
  });

  const scheduler: SchedulerApplication = createSchedulerApplication({
    pollMs: config.pollMs,
    clock,
    readinessCheck: async () => {
      await checkDatabaseConnection(database);
      await queue.ping();
    },
    onTick: async () => {
      await tick.execute(clock.now(), {
        createRunId: () => randomUUID() as RunId,
        createRunAttemptId: () => randomUUID() as RunAttemptId,
        createScheduleOccurrenceId: () => randomUUID() as ScheduleOccurrenceId,
      });
    },
    onClose: async () => {
      await queue.shutdown();
      await database.close();
      await telemetryLifecycle.shutdown();
    },
  });

  return {
    config,
    status: () => scheduler.status(),
    tickOnce: () => scheduler.tickOnce(),
    async start() {
      await scheduler.start();
      logEvent("scheduler.started", { pollMs: config.pollMs });
    },
    async stop() {
      if (scheduler.status() === "stopped") {
        await scheduler.stop();
        return;
      }

      logEvent("scheduler.shutting_down");
      await scheduler.stop();
      logEvent("scheduler.shutdown_complete");
    },
  };
}
