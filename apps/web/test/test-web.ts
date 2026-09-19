import type { WorkflowEventId, WorkspaceId } from "@osva/contracts";
import {
  MemoryAgentRepository,
  MemoryConnectorRepository,
  MemoryEvaluationRepository,
  MemoryJobQueue,
  MemoryModelProfileRepository,
  MemorySecretResolver,
  MemoryToolRepository,
  MemoryRunRepository,
  MemoryScheduleRepository,
  MemoryWorkflowRepository,
  MemoryWorkflowRunRepository,
  MemoryApprovalRequestRepository,
  MemoryWorkflowEventRepository,
  MemoryWorkflowEventWaitResolutionRepository,
  MemoryWorkflowWaitRepository,
  MemoryEvaluationSuiteRepository,
  MemoryMemoryNamespaceRepository,
  MemoryOfficeRepository,
  MemoryWorkspaceRepository,
} from "@osva/adapters-memory";
import {
  Workspace,
  createAgentApplication,
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
import {
  CreateRun,
  IngestWorkflowEvent,
  LaunchAssignment,
  ReconcileAssignment,
} from "@osva/orchestration";

import { createMcpClientPool } from "@osva/adapters-mcp-client";

import { createWebApplication } from "../src/http.js";
import type { RunHttpServices } from "../src/run-http.js";

export const TEST_NOW = new Date("2026-01-15T12:00:00.000Z");

export async function createTestWebApplication(options?: {
  readonly readinessCheck?: () => Promise<boolean>;
  readonly workspaceId?: WorkspaceId;
  readonly idPrefix?: string;
  readonly secrets?: Readonly<Record<string, string>>;
}) {
  const workspaces = new MemoryWorkspaceRepository();
  const agents = new MemoryAgentRepository();
  const modelProfiles = new MemoryModelProfileRepository();
  const connectors = new MemoryConnectorRepository();
  const tools = new MemoryToolRepository();
  const runs = new MemoryRunRepository();
  const schedules = new MemoryScheduleRepository();
  const workflowRepository = new MemoryWorkflowRepository();
  const workflowRunRepository = new MemoryWorkflowRunRepository();
  const approvalRequestRepository = new MemoryApprovalRequestRepository();
  const workflowEventRepository = new MemoryWorkflowEventRepository();
  const workflowWaitRepository = new MemoryWorkflowWaitRepository(
    workflowEventRepository,
    workflowRunRepository,
  );
  const workflowEventWaitResolution =
    new MemoryWorkflowEventWaitResolutionRepository(
      workflowWaitRepository,
      workflowEventRepository,
      workflowRunRepository,
    );
  let workflowEventIdCounter = 0;
  const ingestWorkflowEvent = new IngestWorkflowEvent({
    workflowEvents: workflowEventRepository,
    workflowWaits: workflowWaitRepository,
    eventWaitResolution: workflowEventWaitResolution,
  });
  const memoryNamespaces = new MemoryMemoryNamespaceRepository();
  const evaluationSuites = new MemoryEvaluationSuiteRepository();
  const officeRepository = new MemoryOfficeRepository();
  const queue = new MemoryJobQueue();
  const clock = { now: () => TEST_NOW };
  let counter = 0;
  const prefix = options?.idPrefix ?? "id";
  const ids = {
    createId() {
      counter += 1;
      return `${prefix}-${String(counter)}`;
    },
  };

  if (options?.workspaceId !== undefined) {
    await workspaces.save(
      Workspace.create({
        id: options.workspaceId,
        name: "Workspace",
        createdAt: TEST_NOW,
      }),
    );
  }

  const createRun = new CreateRun({ runs, agents, queue });
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
  });
  const runServices: RunHttpServices = {
    runs: createRunApplication({ runs }),
    createRun,
    clock,
    ids,
  };

  const mcpClientPool = createMcpClientPool({
    secretResolver: new MemorySecretResolver(options?.secrets ?? {}),
  });

  const server = createWebApplication({
    readinessCheck: options?.readinessCheck ?? (async () => true),
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
    runs: runServices,
    runObservability: {
      observability: createRunObservabilityApplication({ runs }),
      evaluations: createEvaluationApplication({
        runs,
        evaluations: new MemoryEvaluationRepository(),
        clock,
        ids,
      }),
    },
    schedules: {
      schedules: createScheduleApplication({
        schedules,
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
        createWorkflowEventId: () => {
          workflowEventIdCounter += 1;
          return `workflow-event-${String(workflowEventIdCounter)}` as WorkflowEventId;
        },
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

  return {
    server,
    workspaces,
    agents,
    modelProfiles,
    connectors,
    tools,
    runs,
    schedules,
    workflows: workflowRepository,
    workflowRuns: workflowRunRepository,
    approvalRequests: approvalRequestRepository,
    workflowEvents: workflowEventRepository,
    queue,
  };
}
