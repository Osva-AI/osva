import { randomUUID } from "node:crypto";

import { BullMqJobQueue, type PingableJobQueue } from "@osva/adapters-bullmq";
import {
  createOpenTelemetryLifecycle,
  type OpenTelemetryLifecycle,
} from "@osva/adapters-opentelemetry";
import { createMcpClientPool } from "@osva/adapters-mcp-client";
import {
  AnthropicProviderAdapter,
  type AnthropicProviderAdapterOptions,
} from "@osva/adapters-model-anthropic";
import {
  GeminiProviderAdapter,
  type GeminiProviderAdapterOptions,
} from "@osva/adapters-model-gemini";
import {
  OpenAIProviderAdapter,
  type OpenAIProviderAdapterOptions,
} from "@osva/adapters-model-openai";
import type { ModelProvider } from "@osva/contracts";
import {
  ProcessEnvSecretResolver,
  RuntimeCapabilityBridge,
  RuntimeExecutionBootstrapStore,
  startRuntimeCapabilityServer,
  type RuntimeCapabilityServer,
} from "@osva/adapters-runtime-http";
import {
  assertTrustedTypeScriptRuntimeReady,
  TrustedTypeScriptRuntimeAdapter,
} from "@osva/adapters-runtime-typescript";
import type { RuntimeAdapter } from "@osva/contracts";
import {
  checkDatabaseConnection,
  createDatabase,
  PostgresAgentRepository,
  PostgresConnectorRepository,
  PostgresEvaluationSuiteRepository,
  PostgresMemoryNamespaceRepository,
  PostgresModelProfileRepository,
  PostgresToolRepository,
  PostgresRunRepository,
  type Database,
} from "@osva/db";
import { createEvaluationRunApplication } from "@osva/domain";
import { MemoryGateway } from "@osva/memory-gateway";
import { ModelGateway, type ModelProviderAdapter } from "@osva/model-gateway";
import {
  createInstrumentedRuntimeAdapter,
  createRunStepRecorder,
} from "@osva/observability";
import { EvaluationCoordinator, ExecuteRunAttempt } from "@osva/orchestration";
import { RuntimeDispatcher } from "@osva/runtime-core";
import { DefaultToolPolicy, ToolGateway } from "@osva/tool-gateway";

import {
  assertDockerEngineAvailable,
  resolveContainerCapabilityBaseUrl,
  suggestContainerCapabilityBaseUrl,
} from "@osva/adapters-runtime-container";

import { loadWorkerConfig, type WorkerConfig } from "./config.js";
import { composeRuntimeExecutors } from "./runtime-composition.js";
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
  readonly telemetry?: OpenTelemetryLifecycle;
  readonly runtime?: RuntimeAdapter;
  readonly clock?: { now(): Date };
  readonly openai?: Omit<OpenAIProviderAdapterOptions, "apiKey"> & {
    readonly apiKey?: string;
  };
  readonly anthropic?: Omit<AnthropicProviderAdapterOptions, "apiKey"> & {
    readonly apiKey?: string;
  };
  readonly gemini?: Omit<GeminiProviderAdapterOptions, "apiKey"> & {
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
  const telemetryLifecycle =
    dependencies.telemetry ?? createOpenTelemetryLifecycle(env);
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
  const injectedRuntime = dependencies.runtime;
  let runtime: RuntimeAdapter | undefined = injectedRuntime;
  let capabilityServer: RuntimeCapabilityServer | undefined;
  let mcpClientPool:
    Awaited<ReturnType<typeof createMcpClientPool>> | undefined;
  let consumeStarted = false;

  const worker: WorkerApplication = createWorkerApplication({
    readinessCheck: async () => {
      await checkDatabaseConnection(database);
      await queue.ping();
      if (injectedRuntime === undefined) {
        await assertTrustedTypeScriptRuntimeReady({
          trustedRuntimeRoot: config.trustedRuntimeRoot ?? "",
        });
        if (config.containerEnabled) {
          await assertDockerEngineAvailable();
        }
      }
    },
    onStart: async () => {
      const modelProfiles = new PostgresModelProfileRepository(database);
      const runsRepository = new PostgresRunRepository(database);
      const agents = new PostgresAgentRepository(database);
      const connectors = new PostgresConnectorRepository(database);
      const memoryNamespaces = new PostgresMemoryNamespaceRepository(database);
      const evaluationSuites = new PostgresEvaluationSuiteRepository(database);
      mcpClientPool = createMcpClientPool({
        secretResolver: new ProcessEnvSecretResolver(env),
      });
      const modelGateway = new ModelGateway({
        modelProfiles,
        providers: composeModelProviders(env, dependencies),
      });
      const toolGateway = new ToolGateway({
        tools: new PostgresToolRepository(database),
        connectors,
        mcpClientPool,
        policy: new DefaultToolPolicy(),
      });
      const memoryGateway = new MemoryGateway({ memoryNamespaces });
      const recorderDeps = {
        runs: runsRepository,
        modelProfiles,
        clock,
        ids: { createId: () => randomUUID() },
        instrumentation,
        logger: {
          info: logEvent,
          error: logError,
        },
      };
      const scopedModel = (
        execution: Parameters<typeof createRunStepRecorder>[0],
      ) =>
        createRunStepRecorder(execution, recorderDeps).wrapModelGateway(
          modelGateway,
        );
      const scopedTool = (
        execution: Parameters<typeof createRunStepRecorder>[0],
      ) =>
        createRunStepRecorder(execution, recorderDeps).wrapToolGateway(
          toolGateway,
        );
      const scopedMemory = (
        execution: Parameters<typeof createRunStepRecorder>[0],
      ) =>
        createRunStepRecorder(execution, recorderDeps).wrapMemoryGateway(
          memoryGateway,
        );

      let capabilityBaseUrl = config.runtimeCapabilityBaseUrl;
      const executionBootstrapStore = new RuntimeExecutionBootstrapStore();
      if (config.runtimeCapabilitySecret !== undefined) {
        const bridge = new RuntimeCapabilityBridge({
          secret: config.runtimeCapabilitySecret,
          runs: runsRepository,
          agents,
          executionBootstrap: executionBootstrapStore,
          clock,
          logger: {
            info: logEvent,
            error: logError,
          },
          createScopedModelGateway: scopedModel,
          createScopedToolGateway: scopedTool,
          createScopedMemoryGateway: scopedMemory,
        });
        const capabilityHost = config.containerEnabled
          ? "0.0.0.0"
          : config.runtimeCapabilityHost;
        capabilityServer = await startRuntimeCapabilityServer({
          host: capabilityHost,
          port: config.runtimeCapabilityPort,
          handler: bridge.handle,
        });
        capabilityBaseUrl = capabilityBaseUrl ?? capabilityServer.origin;
        logEvent("worker.runtime_capability_listening", {
          host: capabilityHost,
          port: capabilityServer.port,
        });
      }

      const containerCapabilityBaseUrl = resolveContainerCapabilityBaseUrl({
        containerCapabilityBaseUrl: config.containerCapabilityBaseUrl,
        runtimeCapabilityBaseUrl: capabilityBaseUrl,
        suggestedBaseUrl:
          capabilityServer === undefined
            ? undefined
            : suggestContainerCapabilityBaseUrl(capabilityServer.port),
      });

      const baseRuntime =
        injectedRuntime ??
        new RuntimeDispatcher({
          executors: composeRuntimeExecutors({
            config,
            trusted: {
              trustedRuntimeRoot: config.trustedRuntimeRoot ?? "",
              trustedAdapter: new TrustedTypeScriptRuntimeAdapter({
                trustedRuntimeRoot: config.trustedRuntimeRoot ?? "",
                logger: {
                  info: logEvent,
                  error: logError,
                },
                modelGateway,
                toolGateway,
                memoryGateway,
                createScopedModelGateway: scopedModel,
                createScopedToolGateway: scopedTool,
                createScopedMemoryGateway: scopedMemory,
              }),
            },
            remoteHttp: {
              getCapabilityBaseUrl: () => capabilityBaseUrl,
              capabilitySecret: config.runtimeCapabilitySecret ?? "",
              allowPrivateNetworks: config.remoteHttpAllowPrivateNetworks,
              clock,
              logger: {
                info: logEvent,
                error: logError,
              },
            },
            container: config.containerEnabled
              ? {
                  getCapabilityBaseUrl: () => containerCapabilityBaseUrl,
                  capabilitySecret: config.runtimeCapabilitySecret ?? "",
                  executionBootstrap: executionBootstrapStore,
                  clock,
                  logger: {
                    info: logEvent,
                    error: logError,
                  },
                }
              : undefined,
            secretResolver: new ProcessEnvSecretResolver(env),
          }),
        });
      runtime = createInstrumentedRuntimeAdapter(baseRuntime, instrumentation);
      const executeRunAttempt = new ExecuteRunAttempt({
        runs: runsRepository,
        agents,
        runtime,
        instrumentation,
      });
      const evaluationCoordinator = new EvaluationCoordinator({
        reconcileEvaluationCase: createEvaluationRunApplication({
          evaluationSuites,
          runs: runsRepository,
          agents,
          queue,
          clock,
          ids: { createId: () => randomUUID() },
        }).reconcileEvaluationCase,
        instrumentation,
      });
      await queue.consume(
        createExecuteRunAttemptHandler(
          executeRunAttempt,
          clock,
          evaluationCoordinator,
        ),
      );
      consumeStarted = true;
    },
    onClose: async () => {
      if (runtime !== undefined && isClosableRuntime(runtime)) {
        await runtime.close();
      }
      if (capabilityServer !== undefined) {
        await capabilityServer.close();
      }
      if (mcpClientPool !== undefined) {
        await mcpClientPool.close();
      }
      await queue.shutdown();
      await database.close();
      await telemetryLifecycle.shutdown();
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

function composeModelProviders(
  env: NodeJS.ProcessEnv,
  dependencies: WorkerProcessDependencies,
): Partial<Record<ModelProvider, ModelProviderAdapter>> {
  const providers: Partial<Record<ModelProvider, ModelProviderAdapter>> = {};

  const openaiApiKey =
    dependencies.openai?.apiKey ?? env.OPENAI_API_KEY?.trim();
  if (openaiApiKey !== undefined && openaiApiKey.length > 0) {
    providers.OPENAI = new OpenAIProviderAdapter({
      apiKey: openaiApiKey,
      baseURL: dependencies.openai?.baseURL,
      fetch: dependencies.openai?.fetch,
      maxRetries: dependencies.openai?.maxRetries,
      timeout: dependencies.openai?.timeout,
    });
  }

  const anthropicApiKey =
    dependencies.anthropic?.apiKey ?? env.ANTHROPIC_API_KEY?.trim();
  if (anthropicApiKey !== undefined && anthropicApiKey.length > 0) {
    providers.ANTHROPIC = new AnthropicProviderAdapter({
      apiKey: anthropicApiKey,
      baseURL: dependencies.anthropic?.baseURL,
      fetch: dependencies.anthropic?.fetch,
      maxRetries: dependencies.anthropic?.maxRetries,
      timeout: dependencies.anthropic?.timeout,
    });
  }

  const geminiApiKey =
    dependencies.gemini?.apiKey ?? env.GOOGLE_GEMINI_API_KEY?.trim();
  if (geminiApiKey !== undefined && geminiApiKey.length > 0) {
    providers.GOOGLE_GEMINI = new GeminiProviderAdapter({
      apiKey: geminiApiKey,
      baseURL: dependencies.gemini?.baseURL,
      fetch: dependencies.gemini?.fetch,
      timeout: dependencies.gemini?.timeout,
    });
  }

  return providers;
}

function isClosableRuntime(
  value: RuntimeAdapter,
): value is RuntimeAdapter & { close(): Promise<void> } {
  return (
    "close" in value &&
    typeof (value as { close?: unknown }).close === "function"
  );
}
