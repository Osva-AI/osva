import type {
  AgentId,
  AgentManifestV1,
  AgentVersionId,
  JobQueue,
  ModelProfileVersionId,
  RunAttemptId,
  RunId,
  WorkspaceId,
} from "@osva/contracts";
import {
  Agent,
  AgentVersion,
  EffectiveRunBindings,
  type AgentRepository,
  type RunRepository,
  type WorkspaceRepository,
  Workspace,
} from "@osva/domain";

export const NOW = new Date("2026-01-15T12:00:00.000Z");
export const LATER = new Date("2026-01-15T12:00:01.000Z");

export const workspaceId = "ws-1" as WorkspaceId;
export const otherWorkspaceId = "ws-2" as WorkspaceId;
export const agentId = "agent-1" as AgentId;
export const otherAgentId = "agent-2" as AgentId;
export const agentVersionId = "agent-version-1" as AgentVersionId;
export const otherAgentVersionId = "agent-version-2" as AgentVersionId;
export const runId = "run-1" as RunId;
export const otherRunId = "run-2" as RunId;
export const runAttemptId = "run-attempt-1" as RunAttemptId;
export const modelProfileVersionId =
  "model-profile-version-1" as ModelProfileVersionId;
export const secondaryModelProfileVersionId =
  "model-profile-version-2" as ModelProfileVersionId;

export const RUN_INPUT = { prompt: "hello from run" };

export function createManifest(
  overrides: Partial<AgentManifestV1> = {},
): AgentManifestV1 {
  return {
    schemaVersion: "1",
    key: "example-agent",
    name: "Example Agent",
    runtime: {
      type: "BUILTIN_PACKAGE",
      key: "example-agent",
    },
    input: { schema: {} },
    output: { schema: {} },
    execution: { timeoutMs: 30_000, maxAttempts: 2 },
    capabilities: { model: false, tools: [] },
    ...overrides,
  };
}

export function createBindings(
  versionId: AgentVersionId = agentVersionId,
): EffectiveRunBindings {
  return EffectiveRunBindings.create({
    agentVersionId: versionId,
    modelProfileVersionBindings: {
      default: modelProfileVersionId,
      "tool.summarize": secondaryModelProfileVersionId,
    },
    toolVersionBindings: {},
    memoryNamespaceBindings: {},
  });
}

export async function seedAgentGraph(
  workspaces: WorkspaceRepository,
  agents: AgentRepository,
  options?: {
    readonly timeoutMs?: number;
    readonly workspaceId?: WorkspaceId;
    readonly agentId?: AgentId;
    readonly agentVersionId?: AgentVersionId;
    readonly key?: string;
  },
): Promise<void> {
  const resolvedWorkspaceId = options?.workspaceId ?? workspaceId;
  const resolvedAgentId = options?.agentId ?? agentId;
  const resolvedVersionId = options?.agentVersionId ?? agentVersionId;

  await workspaces.save(
    Workspace.create({
      id: resolvedWorkspaceId,
      name: "Workspace",
      createdAt: NOW,
    }),
  );
  await agents.saveAgent(
    Agent.create({
      id: resolvedAgentId,
      workspaceId: resolvedWorkspaceId,
      key: options?.key ?? `agent-key-${resolvedAgentId}`,
      name: "Example Agent",
      createdAt: NOW,
    }),
  );
  await agents.saveAgentVersion(
    AgentVersion.create({
      id: resolvedVersionId,
      agentId: resolvedAgentId,
      version: 1,
      manifest: createManifest(
        options?.timeoutMs === undefined
          ? {}
          : { execution: { timeoutMs: options.timeoutMs, maxAttempts: 2 } },
      ),
      createdAt: NOW,
    }),
  );
}

export class FailingJobQueue implements JobQueue {
  async enqueue(): Promise<void> {
    throw new Error("queue unavailable");
  }

  async cancel(): Promise<void> {}

  async consume(): Promise<void> {}

  async shutdown(): Promise<void> {}
}

export function wrapRunRepository(
  inner: RunRepository,
  overrides: Partial<RunRepository>,
): RunRepository {
  return {
    createRunWithInitialAttempt:
      overrides.createRunWithInitialAttempt?.bind(overrides) ??
      inner.createRunWithInitialAttempt.bind(inner),
    saveRun: overrides.saveRun?.bind(overrides) ?? inner.saveRun.bind(inner),
    findRunById:
      overrides.findRunById?.bind(overrides) ?? inner.findRunById.bind(inner),
    findRunByWorkspaceIdempotencyKey:
      overrides.findRunByWorkspaceIdempotencyKey?.bind(overrides) ??
      inner.findRunByWorkspaceIdempotencyKey.bind(inner),
    listRuns: overrides.listRuns?.bind(overrides) ?? inner.listRuns.bind(inner),
    saveRunAttempt:
      overrides.saveRunAttempt?.bind(overrides) ??
      inner.saveRunAttempt.bind(inner),
    findRunAttemptById:
      overrides.findRunAttemptById?.bind(overrides) ??
      inner.findRunAttemptById.bind(inner),
    listRunAttempts:
      overrides.listRunAttempts?.bind(overrides) ??
      inner.listRunAttempts.bind(inner),
    insertRunningRunStep:
      overrides.insertRunningRunStep?.bind(overrides) ??
      inner.insertRunningRunStep.bind(inner),
    finalizeRunStep:
      overrides.finalizeRunStep?.bind(overrides) ??
      inner.finalizeRunStep.bind(inner),
    findRunStepById:
      overrides.findRunStepById?.bind(overrides) ??
      inner.findRunStepById.bind(inner),
    listRunSteps:
      overrides.listRunSteps?.bind(overrides) ?? inner.listRunSteps.bind(inner),
    aggregateRunAttemptUsage:
      overrides.aggregateRunAttemptUsage?.bind(overrides) ??
      inner.aggregateRunAttemptUsage.bind(inner),
    transitionRun:
      overrides.transitionRun?.bind(overrides) ??
      inner.transitionRun.bind(inner),
    transitionRunAttempt:
      overrides.transitionRunAttempt?.bind(overrides) ??
      inner.transitionRunAttempt.bind(inner),
    transitionRunAndAttempt:
      overrides.transitionRunAndAttempt?.bind(overrides) ??
      inner.transitionRunAndAttempt.bind(inner),
  };
}

export function wrapAgentRepository(
  inner: AgentRepository,
  overrides: Partial<AgentRepository>,
): AgentRepository {
  return {
    saveAgent:
      overrides.saveAgent?.bind(overrides) ?? inner.saveAgent.bind(inner),
    findAgentById:
      overrides.findAgentById?.bind(overrides) ??
      inner.findAgentById.bind(inner),
    listAgents:
      overrides.listAgents?.bind(overrides) ?? inner.listAgents.bind(inner),
    updateAgentMetadata:
      overrides.updateAgentMetadata?.bind(overrides) ??
      inner.updateAgentMetadata.bind(inner),
    saveAgentVersion:
      overrides.saveAgentVersion?.bind(overrides) ??
      inner.saveAgentVersion.bind(inner),
    appendAgentVersion:
      overrides.appendAgentVersion?.bind(overrides) ??
      inner.appendAgentVersion.bind(inner),
    findAgentVersionById:
      overrides.findAgentVersionById?.bind(overrides) ??
      inner.findAgentVersionById.bind(inner),
    listAgentVersions:
      overrides.listAgentVersions?.bind(overrides) ??
      inner.listAgentVersions.bind(inner),
  };
}
