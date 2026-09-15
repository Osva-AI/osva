import type {
  AgentId,
  AgentManifestV1,
  AgentVersionId,
  ExecutionRequest,
  ModelProfileVersionId,
  RunAttemptId,
  RunId,
  RunStepId,
  WorkspaceId,
} from "@osva/contracts";
import { EffectiveRunBindings } from "@osva/domain";

export const NOW = new Date("2026-01-15T12:00:00.000Z");
export const LATER = new Date("2026-01-15T12:00:01.000Z");

export const workspaceId = "ws-1" as WorkspaceId;
export const agentId = "agent-1" as AgentId;
export const agentVersionId = "agent-version-1" as AgentVersionId;
export const runId = "run-1" as RunId;
export const otherRunId = "run-2" as RunId;
export const runAttemptId = "run-attempt-1" as RunAttemptId;
export const secondAttemptId = "run-attempt-2" as RunAttemptId;
export const runStepId = "run-step-1" as RunStepId;
export const modelProfileVersionId =
  "model-profile-version-1" as ModelProfileVersionId;

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

export function createBindings(): EffectiveRunBindings {
  return EffectiveRunBindings.create({
    agentVersionId,
    modelProfileVersionBindings: {
      default: modelProfileVersionId,
    },
  });
}

export function createExecutionRequest(
  overrides: Partial<ExecutionRequest> = {},
): ExecutionRequest {
  return {
    runId,
    runAttemptId,
    agentVersionId,
    input: { prompt: "hello" },
    effectiveConfig: { temperature: 0 },
    modelProfileVersionBindings: {
      default: modelProfileVersionId,
    },
    toolGrants: [],
    timeoutMs: 30_000,
    policyContext: {},
    ...overrides,
  };
}
