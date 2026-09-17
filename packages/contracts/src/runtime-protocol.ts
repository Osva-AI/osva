import type { AgentId, AgentVersionId, RunAttemptId, RunId } from "./ids.js";
import type { WorkspaceId } from "./ids.js";
import type { AgentRuntime } from "./agent-manifest.js";
import type {
  EvaluationCaseId,
  EvaluationRunId,
  ModelProfileVersionId,
  ToolVersionId,
} from "./ids.js";
import type { MemoryNamespaceBinding } from "./memory-gateway.js";
import type { ToolGrant } from "./tool.js";

export interface ExecutionEvaluationContext {
  readonly evaluationRunId: EvaluationRunId;
  readonly evaluationCaseId: EvaluationCaseId;
}

export interface ExecutionRequest {
  readonly runId: RunId;
  readonly runAttemptId: RunAttemptId;
  readonly workspaceId: WorkspaceId;
  readonly agentId: AgentId;
  readonly agentVersionId: AgentVersionId;
  readonly runtime: AgentRuntime;
  readonly input: unknown;
  readonly effectiveConfig: Readonly<Record<string, unknown>>;
  readonly modelProfileVersionBindings: Readonly<
    Record<string, ModelProfileVersionId>
  >;
  readonly toolVersionBindings: Readonly<Record<string, ToolVersionId>>;
  readonly memoryNamespaceBindings: Readonly<
    Record<string, MemoryNamespaceBinding>
  >;
  readonly toolGrants: readonly ToolGrant[];
  readonly timeoutMs: number;
  readonly policyContext: Readonly<Record<string, unknown>>;
  readonly evaluationContext?: ExecutionEvaluationContext;
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
