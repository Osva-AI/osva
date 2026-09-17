import { randomUUID } from "node:crypto";

import { BullMqJobQueue, type PingableJobQueue } from "@osva/adapters-bullmq";
import { createOpenTelemetryLifecycle } from "@osva/adapters-opentelemetry";
import type {
  ApprovalRequestId,
  RunAttemptId,
  RunId,
  WorkflowNodeRunId,
} from "@osva/contracts";
import {
  checkDatabaseConnection,
  createDatabase,
  PostgresAgentRepository,
  PostgresApprovalRequestRepository,
  PostgresRunRepository,
  PostgresWorkflowRepository,
  PostgresWorkflowRunRepository,
  type Database,
} from "@osva/db";
import {
  CreateRun,
  ReconcileWorkflowRun,
  WorkflowOrchestratorTick,
} from "@osva/orchestration";

import {
  loadWorkflowOrchestratorConfig,
  type WorkflowOrchestratorConfig,
} from "./config.js";
import { logError, logEvent } from "./log.js";
import {
  createWorkflowOrchestratorApplication,
  type WorkflowOrchestratorApplication,
  type WorkflowOrchestratorStatus,
} from "./loop.js";

export interface WorkflowOrchestratorProcess {
  readonly config: WorkflowOrchestratorConfig;
  start(): Promise<void>;
  stop(): Promise<void>;
  tickOnce(): Promise<void>;
  status(): WorkflowOrchestratorStatus;
}

export interface WorkflowOrchestratorProcessDependencies {
  readonly databaseFactory?: (connectionString: string) => Database;
  readonly queueFactory?: (valkeyUrl: string) => PingableJobQueue;
  readonly clock?: { now(): Date };
}

export function createWorkflowOrchestratorProcess(
  env: NodeJS.ProcessEnv = process.env,
  databaseFactory: (connectionString: string) => Database = (
    connectionString,
  ) => createDatabase({ connectionString }),
  dependencies: WorkflowOrchestratorProcessDependencies = {},
): WorkflowOrchestratorProcess {
  const config = loadWorkflowOrchestratorConfig(env);
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
  const agents = new PostgresAgentRepository(database);
  const workflows = new PostgresWorkflowRepository(database);
  const workflowRuns = new PostgresWorkflowRunRepository(database);
  const approvalRequests = new PostgresApprovalRequestRepository(database);
  const createRun = new CreateRun({ runs, agents, queue, instrumentation });
  const reconcile = new ReconcileWorkflowRun({
    workflows,
    workflowRuns,
    approvalRequests,
    agents,
    runs,
    createRun,
    queue,
    instrumentation,
    logger: {
      info: logEvent,
      error: logEvent,
    },
  });
  const tick = new WorkflowOrchestratorTick({
    workflowRuns,
    reconcile,
    logger: {
      info: logEvent,
      error: logEvent,
    },
  });

  const orchestrator: WorkflowOrchestratorApplication =
    createWorkflowOrchestratorApplication({
      pollMs: config.pollMs,
      readinessCheck: async () => {
        await checkDatabaseConnection(database);
        await queue.ping();
      },
      onTick: async () => {
        await tick.execute(clock.now(), {
          createRunId: () => randomUUID() as RunId,
          createRunAttemptId: () => randomUUID() as RunAttemptId,
          createWorkflowNodeRunId: () => randomUUID() as WorkflowNodeRunId,
          createApprovalRequestId: () => randomUUID() as ApprovalRequestId,
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
    status: () => orchestrator.status(),
    tickOnce: () => orchestrator.tickOnce(),
    async start() {
      await orchestrator.start();
      logEvent("workflow_orchestrator.started", { pollMs: config.pollMs });
    },
    async stop() {
      if (orchestrator.status() === "stopped") {
        await orchestrator.stop();
        return;
      }

      logEvent("workflow_orchestrator.shutting_down");
      await orchestrator.stop();
      logEvent("workflow_orchestrator.shutdown_complete");
    },
  };
}
