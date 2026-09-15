import {
  checkDatabaseConnection,
  createDatabase,
  type Database,
} from "@osva/db";

import { loadWorkerConfig, type WorkerConfig } from "./config.js";
import { logEvent } from "./log.js";
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

export function createWorkerProcess(
  env: NodeJS.ProcessEnv = process.env,
  databaseFactory: (connectionString: string) => Database = (
    connectionString,
  ) => createDatabase({ connectionString }),
): WorkerProcess {
  const config = loadWorkerConfig(env);
  const database = databaseFactory(config.databaseUrl);
  const worker: WorkerApplication = createWorkerApplication({
    readinessCheck: () => checkDatabaseConnection(database),
    onClose: () => database.close(),
  });

  return {
    config,
    status: () => worker.status(),
    async start() {
      await worker.start();
      logEvent("worker.started");
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
