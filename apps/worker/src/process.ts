import { randomUUID } from "node:crypto";

import { BullMqJobQueue, type PingableJobQueue } from "@osva/adapters-bullmq";
import {
  OpenAIProviderAdapter,
  type OpenAIProviderAdapterOptions,
} from "@osva/adapters-model-openai";
import {
  assertTrustedTypeScriptRuntimeReady,
  TrustedTypeScriptRuntimeAdapter,
} from "@osva/adapters-runtime-typescript";
import type { RuntimeAdapter } from "@osva/contracts";
import {
  checkDatabaseConnection,
  createDatabase,
  PostgresAgentRepository,
  PostgresModelProfileRepository,
  PostgresToolRepository,
  PostgresRunRepository,
  type Database,
} from "@osva/db";
import { ModelGateway } from "@osva/model-gateway";
import { createRunStepRecorder } from "@osva/observability";
import { DefaultToolPolicy, ToolGateway } from "@osva/tool-gateway";
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
  readonly openai?: Omit<OpenAIProviderAdapterOptions, "apiKey"> & {
    readonly apiKey?: string;
  };
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
      const modelProfiles = new PostgresModelProfileRepository(database);
      const runsRepository = new PostgresRunRepository(database);
      const modelGateway = new ModelGateway({
        modelProfiles,
        providers: composeOpenAIProviders(env, dependencies.openai),
      });
      const toolGateway = new ToolGateway({
        tools: new PostgresToolRepository(database),
        policy: new DefaultToolPolicy(),
      });
      runtime =
        injectedRuntime ??
        new TrustedTypeScriptRuntimeAdapter({
          trustedRuntimeRoot: config.trustedRuntimeRoot ?? "",
          logger: {
            info: logEvent,
            error: logError,
          },
          modelGateway,
          toolGateway,
          createScopedModelGateway: (execution) =>
            createRunStepRecorder(execution, {
              runs: runsRepository,
              modelProfiles,
              clock,
              ids: { createId: () => randomUUID() },
              logger: {
                info: logEvent,
                error: logError,
              },
            }).wrapModelGateway(modelGateway),
          createScopedToolGateway: (execution) =>
            createRunStepRecorder(execution, {
              runs: runsRepository,
              modelProfiles,
              clock,
              ids: { createId: () => randomUUID() },
              logger: {
                info: logEvent,
                error: logError,
              },
            }).wrapToolGateway(toolGateway),
        });
      const executeRunAttempt = new ExecuteRunAttempt({
        runs: runsRepository,
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

function composeOpenAIProviders(
  env: NodeJS.ProcessEnv,
  openai: WorkerProcessDependencies["openai"],
): ConstructorParameters<typeof ModelGateway>[0]["providers"] {
  const apiKey = openai?.apiKey ?? env.OPENAI_API_KEY?.trim();
  if (apiKey === undefined || apiKey.length === 0) {
    return {};
  }

  return {
    OPENAI: new OpenAIProviderAdapter({
      apiKey,
      baseURL: openai?.baseURL,
      fetch: openai?.fetch,
      maxRetries: openai?.maxRetries,
      timeout: openai?.timeout,
    }),
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
