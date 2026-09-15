import type {
  AgentId,
  AgentManifestV1,
  AgentVersionId,
  DeploymentId,
  ModelProfileVersionId,
  RunAttemptId,
  RunId,
  RunStepId,
  WorkspaceId,
} from "@osva/contracts";

import { EffectiveRunBindings } from "../src/effective-run-bindings.js";

export const NOW = new Date("2026-01-15T12:00:00.000Z");
export const LATER = new Date("2026-01-15T12:00:01.000Z");
export const LATER_STILL = new Date("2026-01-15T12:00:02.000Z");

export const workspaceId = "ws-1" as WorkspaceId;
export const agentId = "agent-1" as AgentId;
export const agentVersionId = "agent-version-1" as AgentVersionId;
export const deploymentId = "deployment-1" as DeploymentId;
export const runId = "run-1" as RunId;
export const runAttemptId = "run-attempt-1" as RunAttemptId;
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
    input: {
      schema: {},
    },
    output: {
      schema: {},
    },
    execution: {
      timeoutMs: 30_000,
      maxAttempts: 2,
    },
    capabilities: {
      model: false,
      tools: [],
    },
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

export const RUN_INPUT = { prompt: "hello" };
