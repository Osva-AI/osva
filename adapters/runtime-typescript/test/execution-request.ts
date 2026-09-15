import type {
  AgentId,
  AgentVersionId,
  ExecutionRequest,
  RunAttemptId,
  RunId,
  WorkspaceId,
} from "@osva/contracts";

export const NOW = new Date("2026-01-15T12:00:00.000Z");

export function createTrustedRequest(
  overrides: Partial<ExecutionRequest> = {},
): ExecutionRequest {
  return {
    runId: "run-1" as RunId,
    runAttemptId: "run-attempt-1" as RunAttemptId,
    workspaceId: "ws-1" as WorkspaceId,
    agentId: "agent-1" as AgentId,
    agentVersionId: "agent-version-1" as AgentVersionId,
    runtime: {
      type: "TRUSTED_TYPESCRIPT",
      entrypoint: "echo-agent.ts",
      integrity: `sha256:${"a".repeat(64)}`,
    },
    input: { prompt: "hello from trusted runtime" },
    effectiveConfig: {},
    modelProfileVersionBindings: {},
    toolGrants: [],
    timeoutMs: 5_000,
    policyContext: {},
    ...overrides,
  };
}
