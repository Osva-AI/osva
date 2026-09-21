import type {
  AgentId,
  AgentVersionId,
  ApprovalRequestId,
  ArtifactId,
  ConnectorId,
  ConnectorVersionId,
  EvaluationCaseId,
  EvaluationRunId,
  EvaluationSuiteId,
  EvaluationSuiteVersionId,
  KnowledgeIndexId,
  KnowledgeSourceId,
  MemoryNamespaceId,
  ModelProfileId,
  ModelProfileVersionId,
  OfficeWorkerId,
  RunAttemptId,
  RunId,
  RunStepId,
  ScheduleId,
  TeamId,
  ToolId,
  ToolVersionId,
  WorkflowId,
  WorkflowNodeRunId,
  WorkflowRunId,
  WorkflowVersionId,
} from "@osva/contracts";
import {
  Agent,
  AgentVersion,
  ApprovalRequest,
  Artifact,
  Connector,
  ConnectorVersion,
  EffectiveRunBindings,
  EvaluationCase,
  EvaluationRun,
  EvaluationSuite,
  EvaluationSuiteVersion,
  KnowledgeIndex,
  KnowledgeSource,
  MemoryNamespace,
  ModelProfile,
  ModelProfileVersion,
  OfficeWorker,
  Run,
  RunAttempt,
  Schedule,
  Team,
  Tool,
  ToolVersion,
  Workflow,
  WorkflowRun,
  computeKnowledgePipelineFingerprint,
  resolveDefaultKnowledgePipeline,
} from "@osva/domain";

import type { createTestWebApplication } from "./test-web.js";
import { TEST_NOW } from "./test-web.js";
import { WS_B } from "./two-workspace-harness.js";

const VALID_DIGEST =
  "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

export interface WorkspaceBFixtures {
  readonly agentId: AgentId;
  readonly agentVersionId: AgentVersionId;
  readonly runId: RunId;
  readonly runAttemptId: RunAttemptId;
  readonly runStepId: RunStepId;
  readonly connectorId: ConnectorId;
  readonly connectorVersionId: ConnectorVersionId;
  readonly toolId: ToolId;
  readonly toolVersionId: ToolVersionId;
  readonly modelProfileId: ModelProfileId;
  readonly modelProfileVersionId: ModelProfileVersionId;
  readonly artifactId: ArtifactId;
  readonly namespaceId: MemoryNamespaceId;
  readonly knowledgeSourceId: KnowledgeSourceId;
  readonly knowledgeIndexId: KnowledgeIndexId;
  readonly evaluationSuiteId: EvaluationSuiteId;
  readonly evaluationSuiteVersionId: EvaluationSuiteVersionId;
  readonly evaluationRunId: EvaluationRunId;
  readonly workflowId: WorkflowId;
  readonly workflowVersionId: WorkflowVersionId;
  readonly workflowRunId: WorkflowRunId;
  readonly approvalRequestId: ApprovalRequestId;
  readonly scheduleId: ScheduleId;
  readonly officeWorkerId: OfficeWorkerId;
  readonly teamId: TeamId;
}

const MANIFEST = {
  schemaVersion: "1" as const,
  key: "b-agent",
  name: "B Agent",
  runtime: { type: "BUILTIN_PACKAGE" as const, key: "b-agent" },
  input: { schema: {} },
  output: { schema: {} },
  execution: { timeoutMs: 30_000, maxAttempts: 1 },
  capabilities: { model: false, tools: [] as const },
};

export async function seedWorkspaceBFixtures(
  ctx: Awaited<ReturnType<typeof createTestWebApplication>>,
): Promise<WorkspaceBFixtures> {
  const agentId = "agent-b" as AgentId;
  const agentVersionId = "agent-version-b" as AgentVersionId;
  await ctx.agents.saveAgent(
    Agent.create({
      id: agentId,
      workspaceId: WS_B,
      key: "agent-b",
      name: "Agent B",
      createdAt: TEST_NOW,
    }),
  );
  await ctx.agents.saveAgentVersion(
    AgentVersion.create({
      id: agentVersionId,
      agentId,
      version: 1,
      manifest: MANIFEST,
      createdAt: TEST_NOW,
    }),
  );

  const bindings = EffectiveRunBindings.create({
    agentVersionId,
    modelProfileVersionBindings: {},
    toolVersionBindings: {},
    memoryNamespaceBindings: {},
    knowledgeIndexBindings: {},
  });
  const runId = "run-b" as RunId;
  const runAttemptId = "run-attempt-b" as RunAttemptId;
  const run = Run.create({
    id: runId,
    workspaceId: WS_B,
    agentId,
    effectiveBindings: bindings,
    input: { prompt: "b" },
    createdAt: TEST_NOW,
  }).transitionTo("QUEUED", TEST_NOW);
  const attempt = RunAttempt.createFirst({
    id: runAttemptId,
    runId,
    createdAt: TEST_NOW,
  });
  await ctx.runs.createRunWithInitialAttempt(run, attempt);

  const connectorId = "connector-b" as ConnectorId;
  await ctx.connectors.saveConnector(
    Connector.create({
      id: connectorId,
      workspaceId: WS_B,
      key: "connector-b",
      name: "Connector B",
      createdAt: TEST_NOW,
      updatedAt: TEST_NOW,
    }),
  );
  const connectorVersionId = "connector-version-b" as ConnectorVersionId;
  await ctx.connectors.saveConnectorVersion(
    ConnectorVersion.create({
      id: connectorVersionId,
      connectorId,
      version: 1,
      kind: "MCP",
      transport: "STREAMABLE_HTTP",
      transportConfig: { endpointUrl: "http://127.0.0.1:9/nope" },
      createdAt: TEST_NOW,
    }),
  );

  const toolId = "tool-b" as ToolId;
  await ctx.tools.saveTool(
    Tool.create({
      id: toolId,
      workspaceId: WS_B,
      key: "tool-b",
      name: "Tool B",
      createdAt: TEST_NOW,
    }),
  );
  const toolVersionId = "tool-version-b" as ToolVersionId;
  await ctx.tools.saveToolVersion(
    ToolVersion.create({
      id: toolVersionId,
      toolId,
      version: 1,
      type: "INTERNAL",
      implementation: "OSVA_ECHO_V1",
      createdAt: TEST_NOW,
    }),
  );

  const modelProfileId = "model-profile-b" as ModelProfileId;
  await ctx.modelProfiles.saveModelProfile(
    ModelProfile.create({
      id: modelProfileId,
      workspaceId: WS_B,
      key: "mp-b",
      name: "MP B",
      createdAt: TEST_NOW,
    }),
  );
  const modelProfileVersionId =
    "model-profile-version-b" as ModelProfileVersionId;
  await ctx.modelProfiles.saveModelProfileVersion(
    ModelProfileVersion.create({
      id: modelProfileVersionId,
      modelProfileId,
      version: 1,
      provider: "OPENAI",
      model: "gpt-b",
      createdAt: TEST_NOW,
    }),
  );

  const artifactId = "artifact-b" as ArtifactId;
  await ctx.artifactsRepository.save(
    Artifact.create({
      id: artifactId,
      workspaceId: WS_B,
      name: "b.txt",
      mediaType: "text/plain",
      sizeBytes: 3,
      digest: VALID_DIGEST,
      metadata: {},
      createdAt: TEST_NOW,
    }),
  );

  const namespaceId = "namespace-b" as MemoryNamespaceId;
  await ctx.memoryNamespaces.saveNamespace(
    MemoryNamespace.create({
      id: namespaceId,
      workspaceId: WS_B,
      key: "ns-b",
      name: "NS B",
      createdAt: TEST_NOW,
      updatedAt: TEST_NOW,
    }),
  );

  const knowledgeSourceId = "ks-b" as KnowledgeSourceId;
  await ctx.knowledgeRepository.saveSource(
    KnowledgeSource.create({
      id: knowledgeSourceId,
      workspaceId: WS_B,
      key: "ks-b",
      name: "KS B",
      artifactId,
      createdAt: TEST_NOW,
    }),
  );
  const pipeline = resolveDefaultKnowledgePipeline({
    provider: "DETERMINISTIC",
    model: "test",
    dimensions: 8,
  });
  const knowledgeIndexId = "ki-b" as KnowledgeIndexId;
  await ctx.knowledgeRepository.saveIndex(
    KnowledgeIndex.create({
      id: knowledgeIndexId,
      workspaceId: WS_B,
      knowledgeSourceId,
      ...pipeline,
      pipelineFingerprint: computeKnowledgePipelineFingerprint(pipeline),
      createdAt: TEST_NOW,
    }),
  );

  const evaluationSuiteId = "eval-suite-b" as EvaluationSuiteId;
  await ctx.evaluationSuites.saveSuite(
    EvaluationSuite.create({
      id: evaluationSuiteId,
      workspaceId: WS_B,
      key: "suite-b",
      name: "Suite B",
      createdAt: TEST_NOW,
      updatedAt: TEST_NOW,
    }),
  );
  const evaluationSuiteVersionId =
    "eval-suite-version-b" as EvaluationSuiteVersionId;
  await ctx.evaluationSuites.saveSuiteVersion(
    EvaluationSuiteVersion.create({
      id: evaluationSuiteVersionId,
      evaluationSuiteId,
      workspaceId: WS_B,
      version: 1,
      cases: [
        EvaluationCase.create({
          id: "eval-case-b" as EvaluationCaseId,
          evaluationSuiteVersionId,
          key: "case-b",
          input: { prompt: "b" },
          evaluator: { type: "JSON_EXACT_MATCH", expected: { prompt: "b" } },
          createdAt: TEST_NOW,
        }),
      ],
      createdAt: TEST_NOW,
    }),
  );
  const evaluationRunId = "eval-run-b" as EvaluationRunId;
  await ctx.evaluationSuites.saveEvaluationRun(
    EvaluationRun.create({
      id: evaluationRunId,
      workspaceId: WS_B,
      evaluationSuiteVersionId,
      targetType: "AGENT_VERSION",
      targetVersionId: agentVersionId,
      createdAt: TEST_NOW,
    }),
  );

  const workflowId = "workflow-b" as WorkflowId;
  await ctx.workflows.saveWorkflow(
    Workflow.create({
      id: workflowId,
      workspaceId: WS_B,
      key: "wf-b",
      name: "WF B",
      createdAt: TEST_NOW,
      updatedAt: TEST_NOW,
    }),
  );
  const workflowVersionId = "workflow-version-b" as WorkflowVersionId;
  await ctx.workflows.appendWorkflowVersion({
    id: workflowVersionId,
    workflowId,
    definition: {
      schemaVersion: "1",
      nodes: [{ key: "n1", type: "AGENT", agentVersionId }],
      edges: [],
    },
    createdAt: TEST_NOW,
  });
  const workflowRunId = "workflow-run-b" as WorkflowRunId;
  await ctx.workflowRuns.saveWorkflowRun(
    WorkflowRun.create({
      id: workflowRunId,
      workspaceId: WS_B,
      workflowId,
      workflowVersionId,
      input: {},
      createdAt: TEST_NOW,
    }).markRunning(TEST_NOW),
  );
  const approvalRequestId = "approval-b" as ApprovalRequestId;
  await ctx.approvalRequests.saveApprovalRequest(
    ApprovalRequest.create({
      id: approvalRequestId,
      workspaceId: WS_B,
      workflowRunId,
      workflowNodeRunId: "node-run-b" as WorkflowNodeRunId,
      createdAt: TEST_NOW,
    }),
  );

  const scheduleId = "schedule-b" as ScheduleId;
  await ctx.schedules.saveSchedule(
    Schedule.create({
      id: scheduleId,
      workspaceId: WS_B,
      key: "sched-b",
      name: "Sched B",
      agentId,
      agentVersionId,
      cronExpression: "0 0 * * *",
      timezone: "UTC",
      input: {},
      enabled: true,
      now: TEST_NOW,
    }),
  );

  const officeWorkerId = "worker-b" as OfficeWorkerId;
  await ctx.office.saveOfficeWorker(
    OfficeWorker.create({
      id: officeWorkerId,
      workspaceId: WS_B,
      key: "worker-b",
      name: "Worker B",
      agentId,
      now: TEST_NOW,
    }),
  );
  const teamId = "team-b" as TeamId;
  await ctx.office.saveTeam(
    Team.create({
      id: teamId,
      workspaceId: WS_B,
      key: "team-b",
      name: "Team B",
      now: TEST_NOW,
    }),
  );

  return {
    agentId,
    agentVersionId,
    runId,
    runAttemptId,
    runStepId: "run-step-b" as RunStepId,
    connectorId,
    connectorVersionId,
    toolId,
    toolVersionId,
    modelProfileId,
    modelProfileVersionId,
    artifactId,
    namespaceId,
    knowledgeSourceId,
    knowledgeIndexId,
    evaluationSuiteId,
    evaluationSuiteVersionId,
    evaluationRunId,
    workflowId,
    workflowVersionId,
    workflowRunId,
    approvalRequestId,
    scheduleId,
    officeWorkerId,
    teamId,
  };
}
