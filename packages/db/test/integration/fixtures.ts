import type {
  AgentId,
  AgentManifestV1,
  AgentVersionId,
  ModelProfileVersionId,
  RunAttemptId,
  RunId,
  RunStepId,
  WorkspaceId,
} from "@osva/contracts";
import { EffectiveRunBindings } from "@osva/domain";

export const NOW = new Date("2026-01-15T12:00:00.000Z");
export const LATER = new Date("2026-01-15T12:00:01.000Z");
export const EVEN_LATER = new Date("2026-01-15T12:00:02.000Z");

export function createIds(label: string) {
  return {
    workspaceId: `workspace_${label}` as WorkspaceId,
    agentId: `agent_${label}` as AgentId,
    otherAgentId: `agent_${label}_other` as AgentId,
    agentVersionId: `agent_version_${label}` as AgentVersionId,
    otherAgentVersionId: `agent_version_${label}_other` as AgentVersionId,
    runId: `run_${label}` as RunId,
    otherRunId: `run_${label}_other` as RunId,
    runAttemptId: `run_attempt_${label}` as RunAttemptId,
    secondAttemptId: `run_attempt_${label}_2` as RunAttemptId,
    otherAttemptId: `run_attempt_${label}_other` as RunAttemptId,
    runStepId: `run_step_${label}` as RunStepId,
    modelProfileVersionId:
      `model_profile_version_${label}` as ModelProfileVersionId,
  };
}

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

export const RUN_INPUT = { prompt: "hello" };

export function createBindings(
  agentVersionId: AgentVersionId,
  modelProfileVersionId: ModelProfileVersionId,
): EffectiveRunBindings {
  return EffectiveRunBindings.create({
    agentVersionId,
    modelProfileVersionBindings: {
      default: modelProfileVersionId,
      "tool.summarize":
        `${modelProfileVersionId}_secondary` as ModelProfileVersionId,
    },
  });
}
