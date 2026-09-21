import type {
  SecretResolver,
  WorkflowEventId,
  WorkspaceId,
} from "@osva/contracts";
import {
  createArtifactBlobStore,
  loadArtifactStorageConfig,
} from "@osva/adapters-artifact-storage";
import {
  MemoryApiKeyRepository,
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
  MemoryArtifactRepository,
  MemoryOfficeRepository,
  MemoryWorkspaceRepository,
} from "@osva/adapters-memory";
import {
  Workspace,
  createAgentApplication,
  createArtifactApplication,
  createConnectorApplication,
  createEvaluationApplication,
  createEvaluationRunApplication,
  createEvaluationSuiteApplication,
  createKnowledgeApplication,
  createMemoryApplication,
  createModelProfileApplication,
  createRunApplication,
  createRunObservabilityApplication,
  createScheduleApplication,
  createToolApplication,
  createWorkflowApplication,
  createOfficeApplication,
  AuthenticateApiKey,
  KnowledgeRetriever,
  createApiKeyApplication,
} from "@osva/domain";
import {
  CreateRun,
  IngestWorkflowEvent,
  LaunchAssignment,
  ReconcileAssignment,
} from "@osva/orchestration";

import { createMcpClientPool } from "@osva/adapters-mcp-client";
import os from "node:os";
import path from "node:path";

import { TestMemoryKnowledgeRepository } from "./support/memory-knowledge-repository.js";

import { createWebApplication } from "../src/http.js";
import type { RunHttpServices } from "../src/run-http.js";
import {
  createTestWebSecurityServices,
  seedTestApiKey,
} from "../src/test-security.js";

export const TEST_NOW = new Date("2026-01-15T12:00:00.000Z");

export {
  authorizationHeader,
  seedTestApiKey,
  type TestApiKeyRecord,
} from "../src/test-security.js";

export async function createTestWebApplication(options?: {
  readonly readinessCheck?: () => Promise<boolean>;
  readonly workspaceId?: WorkspaceId;
  readonly idPrefix?: string;
  readonly secrets?: Readonly<Record<string, string>>;
  readonly stdioConnectorsEnabled?: boolean;
  readonly secretResolver?: SecretResolver;
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
  const artifactsRepository = new MemoryArtifactRepository();
  const artifactStorage = loadArtifactStorageConfig({
    OSVA_ARTIFACT_FILESYSTEM_ROOT: path.join(
      os.tmpdir(),
      `osva-artifacts-test-${String(process.pid)}`,
    ),
  });
  const artifactBlobStore = createArtifactBlobStore(artifactStorage);
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

  const workspaceId =
    options?.workspaceId ?? (`ws-test-${String(process.pid)}` as WorkspaceId);
  await workspaces.save(
    Workspace.create({
      id: workspaceId,
      name: "Workspace",
      createdAt: TEST_NOW,
    }),
  );

  const apiKeys = new MemoryApiKeyRepository();
  const testApiKey = await seedTestApiKey({
    apiKeys,
    workspaceId,
    now: TEST_NOW,
  });
  const authenticateApiKey = new AuthenticateApiKey({
    apiKeys,
    clock: { now: () => TEST_NOW },
  });
  const security = createTestWebSecurityServices(authenticateApiKey);

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

  const stdioConnectorsEnabled = options?.stdioConnectorsEnabled ?? true;
  const secretResolver =
    options?.secretResolver ?? new MemorySecretResolver(options?.secrets ?? {});
  const mcpClientPool = createMcpClientPool({
    secretResolver,
    stdioConnectorsEnabled,
    allowPrivateNetworks: true,
  });
  const mcpRuntimePolicy = { stdioConnectorsEnabled };

  const knowledgeRepository = new TestMemoryKnowledgeRepository();
  const embeddingDefaults = {
    provider: "DETERMINISTIC",
    model: "test",
    dimensions: 8,
  };
  const knowledgeApplication = createKnowledgeApplication({
    knowledge: knowledgeRepository,
    artifacts: artifactsRepository,
    workspaces,
    indexQueue: {
      enqueue: async () => undefined,
      start: async () => undefined,
      stop: async () => undefined,
    },
    embeddingDefaults,
    clock,
    ids,
  });
  const knowledgeRetriever = new KnowledgeRetriever({
    knowledge: knowledgeRepository,
    embeddings: {
      embed: async () => ({ vectors: [] }),
    } as never,
    vectorStore: {
      search: async () => [],
    } as never,
  });

  const server = createWebApplication({
    readinessCheck: options?.readinessCheck ?? (async () => true),
    agents: createAgentApplication({
      agents,
      workspaces,
      modelProfiles,
      tools,
      memoryNamespaces,
      knowledge: knowledgeRepository,
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
      mcpRuntimePolicy,
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
    knowledge: {
      knowledge: knowledgeApplication,
      retriever: knowledgeRetriever,
    },
    apiKeys: createApiKeyApplication({
      apiKeys,
      workspaces,
      clock,
      ids,
    }),
    security,
  });

  return {
    server,
    workspaceId,
    testApiKey,
    apiKeys,
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
    workflowWaits: workflowWaitRepository,
    knowledgeRepository,
    memoryNamespaces,
    artifactsRepository,
    evaluationSuites,
    office: officeRepository,
    queue,
  };
}
