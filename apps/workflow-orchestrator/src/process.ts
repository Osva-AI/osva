import { randomUUID } from "node:crypto";

import { BullMqJobQueue, type PingableJobQueue } from "@osva/adapters-bullmq";
import { createOpenTelemetryLifecycle } from "@osva/adapters-opentelemetry";
import type {
  ApprovalRequestId,
  RunAttemptId,
  RunId,
  WorkflowNodeRunId,
} from "@osva-ai/contracts";
import {
  assertPostgresAndValkeyReady,
  checkDatabaseConnection,
  createDatabase,
  startProcessProbeServer,
  type ProcessProbeServer,
  PostgresAgentRepository,
  PostgresApprovalRequestRepository,
  PostgresRunRepository,
  PostgresWorkflowRepository,
  PostgresWorkflowRunRepository,
  PostgresWorkflowEventWaitResolutionRepository,
  PostgresWorkflowTimerWaitResolutionRepository,
  PostgresWorkflowWaitRepository,
  type Database,
} from "@osva/db";
import {
  CreateRun,
  ProcessDueTimerWaits,
  ProcessResolvableEventWaits,
  ReconcileWorkflowRun,
  WorkflowOrchestratorTick,
  WorkflowWaitDriverTick,
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
import { runWorkflowOrchestratorPipeline } from "./tick-pipeline.js";

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
  const telemetryLifecycle = createOpenTelemetryLifecycle(env, {
    defaultServiceName: "osva-workflow-orchestrator",
  });
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
  const workflowWaits = new PostgresWorkflowWaitRepository(database);
  const approvalRequests = new PostgresApprovalRequestRepository(database);
  const createRun = new CreateRun({ runs, agents, queue, instrumentation });
  const reconcile = new ReconcileWorkflowRun({
    workflows,
    workflowRuns,
    workflowWaits,
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
  const timerWaitResolution = new PostgresWorkflowTimerWaitResolutionRepository(
    database,
  );
  const eventWaitResolution = new PostgresWorkflowEventWaitResolutionRepository(
    database,
  );
  const waitDriver = new WorkflowWaitDriverTick({
    processDueTimerWaits: new ProcessDueTimerWaits({
      workflowWaits,
      timerWaitResolution,
    }),
    processResolvableEventWaits: new ProcessResolvableEventWaits({
      workflowWaits,
      eventWaitResolution,
    }),
  });
  let probeServer: ProcessProbeServer | undefined;
  const readinessCheck = async () => {
    await assertPostgresAndValkeyReady(
      database,
      queue,
      checkDatabaseConnection,
    );
  };
  const workflowTick = new WorkflowOrchestratorTick({
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
      readinessCheck,
      onTick: async () => {
        const now = clock.now();
        await runWorkflowOrchestratorPipeline({
          now,
          waitDriver,
          workflowTick,
          ids: {
            createRunId: () => randomUUID() as RunId,
            createRunAttemptId: () => randomUUID() as RunAttemptId,
            createWorkflowNodeRunId: () => randomUUID() as WorkflowNodeRunId,
            createApprovalRequestId: () => randomUUID() as ApprovalRequestId,
          },
        });
      },
      onClose: async () => {
        if (probeServer !== undefined) {
          await probeServer.close();
          probeServer = undefined;
        }
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
      probeServer = await startProcessProbeServer({
        host: config.health.host,
        port: config.health.port,
        readinessCheck,
      });
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
