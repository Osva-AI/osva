import type { AgentId, AgentVersionId, RunAttemptId, RunId } from "./ids.js";
import type { WorkspaceId } from "./ids.js";
import type { AgentRuntime } from "./agent-manifest.js";
import type {
  EvaluationCaseId,
  EvaluationRunId,
  KnowledgeIndexId,
  ModelProfileVersionId,
  ToolVersionId,
} from "./ids.js";
import type { MemoryNamespaceBinding } from "./memory-gateway.js";
import type { ToolGrant } from "./tool.js";

/** Maximum tool grants attached to one execution request envelope. */
export const EXECUTION_MAX_TOOL_GRANTS = 64;

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
  readonly knowledgeIndexBindings: Readonly<
    Record<string, readonly KnowledgeIndexId[]>
  >;
  readonly toolGrants: readonly ToolGrant[];
  readonly timeoutMs: number;
  readonly policyContext: Readonly<Record<string, unknown>>;
  readonly evaluationContext?: ExecutionEvaluationContext;
  readonly restrictPersistentMemory?: boolean;
}

export function allowsPersistentMemoryMutation(
  execution: Readonly<{
    readonly evaluationContext?: ExecutionEvaluationContext;
    readonly restrictPersistentMemory?: boolean;
  }>,
): boolean {
  if (execution.evaluationContext !== undefined) {
    return false;
  }
  if (execution.restrictPersistentMemory === true) {
    return false;
  }
  return true;
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
  /**
   * Best-effort cooperative cancel after lease loss. Implementations must not
   * treat cancellation as undoing completed external side effects.
   */
  cancel?(runAttemptId: RunAttemptId): Promise<void>;
}
