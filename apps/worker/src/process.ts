import { BullMqJobQueue, type PingableJobQueue } from "@osva/adapters-bullmq";
import {
  assertTrustedTypeScriptRuntimeReady,
  TrustedTypeScriptRuntimeAdapter,
} from "@osva/adapters-runtime-typescript";
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
  const injectedRuntime = dependencies.runtime;
  let runtime: RuntimeAdapter | undefined = injectedRuntime;
  let consumeStarted = false;

  const worker: WorkerApplication = createWorkerApplication({
    readinessCheck: async () => {
      await checkDatabaseConnection(database);
      await queue.ping();
      if (injectedRuntime === undefined) {
        await assertTrustedTypeScriptRuntimeReady({
          trustedRuntimeRoot: config.trustedRuntimeRoot ?? "",
        });
      }
    },
    onStart: async () => {
      runtime =
        injectedRuntime ??
        new TrustedTypeScriptRuntimeAdapter({
          trustedRuntimeRoot: config.trustedRuntimeRoot ?? "",
          logger: {
            info: logEvent,
            error: logError,
          },
        });
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
      if (runtime !== undefined && isClosableRuntime(runtime)) {
        await runtime.close();
      }
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

function isClosableRuntime(
  value: RuntimeAdapter,
): value is RuntimeAdapter & { close(): Promise<void> } {
  return (
    "close" in value &&
    typeof (value as { close?: unknown }).close === "function"
  );
}
