import type { AgentVersionId, RunAttemptId, RunId } from "./ids.js";
import type { ModelProfileVersionId } from "./ids.js";
import type { ToolGrant } from "./tool.js";

export interface ExecutionRequest {
  readonly runId: RunId;
  readonly runAttemptId: RunAttemptId;
  readonly agentVersionId: AgentVersionId;
  readonly input: unknown;
  readonly effectiveConfig: Readonly<Record<string, unknown>>;
  readonly modelProfileVersionBindings: Readonly<
    Record<string, ModelProfileVersionId>
  >;
  readonly toolGrants: readonly ToolGrant[];
  readonly timeoutMs: number;
  readonly policyContext: Readonly<Record<string, unknown>>;
}

export interface ExecutionError {
  readonly code: string;
  readonly message: string;
}

export interface ExecutionSuccess {
  readonly status: "succeeded";
  readonly output: unknown;
}

export interface ExecutionFailure {
  readonly status: "failed";
  readonly error: ExecutionError;
}

export type ExecutionResult = ExecutionSuccess | ExecutionFailure;

/**
 * Executes one AgentVersion for a canonical RunAttempt.
 * Queue delivery IDs are infrastructure metadata and are not part of this protocol.
 */
export interface RuntimeAdapter {
  execute(request: ExecutionRequest): Promise<ExecutionResult>;
}
