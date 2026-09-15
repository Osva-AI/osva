import type { Server } from "node:http";
import { createDatabase, type Database } from "@osva/db";

import { loadWebConfig, type WebConfig } from "./config.js";
import { createWebApplication } from "./http.js";
import { logEvent } from "./log.js";
import { postgresReadinessCheck } from "./readiness.js";
import { closeHttpServer, listenHttpServer } from "./server.js";

export interface WebProcess {
  readonly config: WebConfig;
  readonly server: Server;
  listen(): Promise<number>;
  stop(): Promise<void>;
}

export function createWebProcess(
  env: NodeJS.ProcessEnv = process.env,
  databaseFactory: (connectionString: string) => Database = (
    connectionString,
  ) => createDatabase({ connectionString }),
): WebProcess {
  const config = loadWebConfig(env);
  const database = databaseFactory(config.databaseUrl);
  const server = createWebApplication({
    readinessCheck: postgresReadinessCheck(database),
  });

  let stopping: Promise<void> | undefined;

  return {
    config,
    server,
    async listen() {
      const port = await listenHttpServer(server, config.host, config.port);
      logEvent("web.listening", { host: config.host, port });
      return port;
    },
    stop() {
      if (stopping) {
        return stopping;
      }

      stopping = (async () => {
        logEvent("web.shutting_down");
        await closeHttpServer(server);
        await database.close();
        logEvent("web.shutdown_complete");
      })();

      return stopping;
    },
  };
}
