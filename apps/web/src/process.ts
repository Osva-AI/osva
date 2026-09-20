import { randomUUID } from "node:crypto";
import type { WorkflowEventId } from "@osva/contracts";
import type { Server } from "node:http";
import { BullMqJobQueue, type PingableJobQueue } from "@osva/adapters-bullmq";
import {
  createArtifactBlobStore,
  loadArtifactStorageConfig,
} from "@osva/adapters-artifact-storage";
import {
  createOpenTelemetryLifecycle,
  type OpenTelemetryLifecycle,
} from "@osva/adapters-opentelemetry";
import {
  createDatabase,
  PostgresAgentRepository,
  PostgresConnectorRepository,
  PostgresModelProfileRepository,
  PostgresToolRepository,
  PostgresRunRepository,
  PostgresScheduleRepository,
  PostgresWorkflowRepository,
  PostgresWorkflowRunRepository,
  PostgresApprovalRequestRepository,
  PostgresWorkflowEventRepository,
  PostgresWorkflowEventWaitResolutionRepository,
  PostgresWorkflowWaitRepository,
  PostgresEvaluationSuiteRepository,
  PostgresMemoryNamespaceRepository,
  PostgresArtifactRepository,
  PostgresOfficeRepository,
  PostgresWorkspaceRepository,
  type Database,
} from "@osva/db";
import {
  createAgentApplication,
  createArtifactApplication,
  createConnectorApplication,
  createEvaluationApplication,
  createEvaluationRunApplication,
  createEvaluationSuiteApplication,
  createMemoryApplication,
  createModelProfileApplication,
  createRunApplication,
  createRunObservabilityApplication,
  createScheduleApplication,
  createToolApplication,
  createWorkflowApplication,
  createOfficeApplication,
} from "@osva/domain";
import { PostgresEvaluationRepository } from "@osva/db";
import { createMcpClientPool } from "@osva/adapters-mcp-client";
import { ProcessEnvSecretResolver } from "@osva/adapters-runtime-http";
import {
  CreateRun,
  IngestWorkflowEvent,
  LaunchAssignment,
  ReconcileAssignment,
} from "@osva/orchestration";

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

export interface WebProcessDependencies {
  readonly telemetry?: OpenTelemetryLifecycle;
}

export function createWebProcess(
  env: NodeJS.ProcessEnv = process.env,
  databaseFactory: (connectionString: string) => Database = (
    connectionString,
  ) => createDatabase({ connectionString }),
  queueFactory?: (valkeyUrl: string) => PingableJobQueue,
  dependencies: WebProcessDependencies = {},
): WebProcess {
  const config = loadWebConfig(env);
  const artifactStorage = loadArtifactStorageConfig(env);
  const telemetryLifecycle =
    dependencies.telemetry ?? createOpenTelemetryLifecycle(env);
  const instrumentation = telemetryLifecycle.instrumentation;
  const database = databaseFactory(config.databaseUrl);
  const createQueue =
    queueFactory ??
    ((valkeyUrl: string) =>
      new BullMqJobQueue({ url: valkeyUrl, instrumentation }));
  const queue = createQueue(config.valkeyUrl);
  const agents = new PostgresAgentRepository(database);
  const workspaces = new PostgresWorkspaceRepository(database);
  const modelProfiles = new PostgresModelProfileRepository(database);
  const tools = new PostgresToolRepository(database);
  const connectors = new PostgresConnectorRepository(database);
  const runs = new PostgresRunRepository(database);
  const scheduleRepository = new PostgresScheduleRepository(database);
  const workflowRepository = new PostgresWorkflowRepository(database);
  const workflowRunRepository = new PostgresWorkflowRunRepository(database);
  const approvalRequestRepository = new PostgresApprovalRequestRepository(
    database,
  );
  const workflowWaitRepository = new PostgresWorkflowWaitRepository(database);
  const workflowEventRepository = new PostgresWorkflowEventRepository(database);
  const workflowEventWaitResolution =
    new PostgresWorkflowEventWaitResolutionRepository(database);
  const ingestWorkflowEvent = new IngestWorkflowEvent({
    workflowEvents: workflowEventRepository,
    workflowWaits: workflowWaitRepository,
    eventWaitResolution: workflowEventWaitResolution,
  });
  const memoryNamespaces = new PostgresMemoryNamespaceRepository(database);
  const artifactsRepository = new PostgresArtifactRepository(database);
  const artifactBlobStore = createArtifactBlobStore(artifactStorage);
  const evaluationSuites = new PostgresEvaluationSuiteRepository(database);
  const officeRepository = new PostgresOfficeRepository(database);
  const clock = { now: () => new Date() };
  const ids = { createId: () => randomUUID() };
  const createRun = new CreateRun({
    runs,
    agents,
    queue,
    instrumentation,
  });
  const reconcileAssignment = new ReconcileAssignment({
    office: officeRepository,
    runs,
    workflowRuns: workflowRunRepository,
  });
  const launchAssignment = new LaunchAssignment({
    office: officeRepository,
    agents,
    workflows: workflowRepository,
    workflowRuns: workflowRunRepository,
    runs,
    createRun,
    reconcileAssignment,
    instrumentation,
  });
  const mcpClientPool = createMcpClientPool({
    secretResolver: new ProcessEnvSecretResolver(env),
  });
  const server = createWebApplication({
    readinessCheck: postgresAndValkeyReadinessCheck(database, queue),
    agents: createAgentApplication({
      agents,
      workspaces,
      modelProfiles,
      tools,
      memoryNamespaces,
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
    connectors: createConnectorApplication({
      connectors,
      tools,
      workspaces,
      mcpClientPool,
      clock,
      ids,
    }),
    memory: createMemoryApplication({
      memoryNamespaces,
      workspaces,
      clock,
      ids,
    }),
    artifacts: createArtifactApplication({
      artifacts: artifactsRepository,
      blobStore: artifactBlobStore,
      workspaces,
      runs,
      maxBytes: artifactStorage.maxBytes,
      clock,
      ids,
      logger: {
        info: (message, fields) => logEvent(message, fields),
        warn: (message, fields) => logEvent(message, fields),
      },
    }),
    artifactMaxBytes: artifactStorage.maxBytes,
    evaluations: {
      suites: createEvaluationSuiteApplication({
        evaluationSuites,
        workspaces,
        clock,
        ids,
      }),
      runs: createEvaluationRunApplication({
        evaluationSuites,
        runs,
        agents,
        queue,
        clock,
        ids,
      }),
    },
    runs: {
      runs: createRunApplication({ runs }),
      createRun,
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
      approvalRequests: approvalRequestRepository,
      agents,
      workspaces,
      clock,
      ids,
    }),
    workflowEvents: {
      ingest: ingestWorkflowEvent,
      clock,
      ids: {
        createWorkflowEventId: () => randomUUID() as WorkflowEventId,
      },
    },
    office: {
      office: createOfficeApplication({
        office: officeRepository,
        workspaces,
        agents,
        workflows: workflowRepository,
        clock,
        ids,
      }),
      launchAssignment,
      reconcileAssignment,
      clock,
      ids,
    },
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
        await telemetryLifecycle.shutdown();
        logEvent("web.shutdown_complete");
      })();

      return stopping;
    },
  };
}
