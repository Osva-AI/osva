import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import { BullMqJobQueue, type PingableJobQueue } from "@osva/adapters-bullmq";
import {
  createDatabase,
  PostgresAgentRepository,
  PostgresModelProfileRepository,
  PostgresToolRepository,
  PostgresRunRepository,
  PostgresScheduleRepository,
  PostgresWorkflowRepository,
  PostgresWorkflowRunRepository,
  PostgresWorkspaceRepository,
  type Database,
} from "@osva/db";
import {
  createAgentApplication,
  createEvaluationApplication,
  createModelProfileApplication,
  createRunApplication,
  createRunObservabilityApplication,
  createScheduleApplication,
  createToolApplication,
  createWorkflowApplication,
} from "@osva/domain";
import { PostgresEvaluationRepository } from "@osva/db";
import { CreateRun } from "@osva/orchestration";

import { loadWebConfig, type WebConfig } from "./config.js";
import { createWebApplication } from "./http.js";
import { logEvent } from "./log.js";
import { postgresAndValkeyReadinessCheck } from "./readiness.js";
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
  queueFactory: (valkeyUrl: string) => PingableJobQueue = (valkeyUrl) =>
    new BullMqJobQueue({ url: valkeyUrl }),
): WebProcess {
  const config = loadWebConfig(env);
  const database = databaseFactory(config.databaseUrl);
  const queue = queueFactory(config.valkeyUrl);
  const agents = new PostgresAgentRepository(database);
  const workspaces = new PostgresWorkspaceRepository(database);
  const modelProfiles = new PostgresModelProfileRepository(database);
  const tools = new PostgresToolRepository(database);
  const runs = new PostgresRunRepository(database);
  const scheduleRepository = new PostgresScheduleRepository(database);
  const workflowRepository = new PostgresWorkflowRepository(database);
  const workflowRunRepository = new PostgresWorkflowRunRepository(database);
  const clock = { now: () => new Date() };
  const ids = { createId: () => randomUUID() };
  const server = createWebApplication({
    readinessCheck: postgresAndValkeyReadinessCheck(database, queue),
    agents: createAgentApplication({
      agents,
      workspaces,
      modelProfiles,
      tools,
      clock,
      ids,
    }),
    modelProfiles: createModelProfileApplication({
      modelProfiles,
      workspaces,
      clock,
      ids,
    }),
    tools: createToolApplication({
      tools,
      workspaces,
      clock,
      ids,
    }),
    runs: {
      runs: createRunApplication({ runs }),
      createRun: new CreateRun({
        runs,
        agents,
        queue,
      }),
      clock,
      ids,
    },
    runObservability: {
      observability: createRunObservabilityApplication({ runs }),
      evaluations: createEvaluationApplication({
        runs,
        evaluations: new PostgresEvaluationRepository(database),
        clock,
        ids,
      }),
    },
    schedules: {
      schedules: createScheduleApplication({
        schedules: scheduleRepository,
        agents,
        workspaces,
        clock,
        ids,
      }),
      clock,
      ids,
    },
    workflows: createWorkflowApplication({
      workflows: workflowRepository,
      workflowRuns: workflowRunRepository,
      agents,
      workspaces,
      clock,
      ids,
    }),
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
        await queue.shutdown();
        await database.close();
        logEvent("web.shutdown_complete");
      })();

      return stopping;
    },
  };
}
