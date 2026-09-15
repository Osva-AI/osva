import { BullMqJobQueue, type PingableJobQueue } from "@osva/adapters-bullmq";
import type { RuntimeAdapter } from "@osva/contracts";
import {
  checkDatabaseConnection,
  createDatabase,
  PostgresAgentRepository,
  PostgresRunRepository,
  type Database,
} from "@osva/db";
import { ExecuteRunAttempt } from "@osva/orchestration";

import { loadWorkerConfig, type WorkerConfig } from "./config.js";
import { createExecuteRunAttemptHandler } from "./execute-run-attempt-handler.js";
import { logError, logEvent } from "./log.js";
import {
  createWorkerApplication,
  type WorkerApplication,
  type WorkerStatus,
} from "./worker.js";

export interface WorkerProcess {
  readonly config: WorkerConfig;
  start(): Promise<void>;
  stop(): Promise<void>;
  status(): WorkerStatus;
}

export interface WorkerProcessDependencies {
  readonly databaseFactory?: (connectionString: string) => Database;
  readonly queueFactory?: (valkeyUrl: string) => PingableJobQueue;
  readonly runtime?: RuntimeAdapter;
  readonly clock?: { now(): Date };
}

export function createWorkerProcess(
  env: NodeJS.ProcessEnv = process.env,
  databaseFactory: (connectionString: string) => Database = (
    connectionString,
  ) => createDatabase({ connectionString }),
  dependencies: WorkerProcessDependencies = {},
): WorkerProcess {
  const config = loadWorkerConfig(env);
  const createDatabaseHandle = dependencies.databaseFactory ?? databaseFactory;
  const createQueue =
    dependencies.queueFactory ??
    ((valkeyUrl: string) =>
      new BullMqJobQueue({
        url: valkeyUrl,
        logger: {
          info: logEvent,
          error: logError,
        },
      }));
  const database = createDatabaseHandle(config.databaseUrl);
  const queue = createQueue(config.valkeyUrl);
  const clock = dependencies.clock ?? { now: () => new Date() };
  const runtime = dependencies.runtime;

  let consumeStarted = false;
  const worker: WorkerApplication = createWorkerApplication({
    readinessCheck: async () => {
      await checkDatabaseConnection(database);
      await queue.ping();
    },
    onStart: async () => {
      if (runtime === undefined) {
        return;
      }

      const executeRunAttempt = new ExecuteRunAttempt({
        runs: new PostgresRunRepository(database),
        agents: new PostgresAgentRepository(database),
        runtime,
      });
      await queue.consume(
        createExecuteRunAttemptHandler(executeRunAttempt, clock),
      );
      consumeStarted = true;
    },
    onClose: async () => {
      await queue.shutdown();
      await database.close();
    },
  });

  return {
    config,
    status: () => worker.status(),
    async start() {
      await worker.start();
      logEvent("worker.started", { consuming: consumeStarted });
    },
    async stop() {
      if (worker.status() === "stopped") {
        await worker.stop();
        return;
      }

      logEvent("worker.shutting_down");
      await worker.stop();
      logEvent("worker.shutdown_complete");
    },
  };
}
