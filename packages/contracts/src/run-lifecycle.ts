import type {
  AgentId,
  AgentVersionId,
  RunAttemptId,
  RunId,
  WorkspaceId,
} from "./ids.js";
import type { JsonValue } from "./json-value.js";
import type { RunAttemptState, RunState } from "./run-state.js";

export interface CreateRunRequestV1 {
  readonly workspaceId: WorkspaceId;
  readonly agentId: AgentId;
  readonly agentVersionId: AgentVersionId;
  readonly input: unknown;
  readonly idempotencyKey?: string;
}

export interface RunResourceV1 {
  readonly id: RunId;
  readonly workspaceId: WorkspaceId;
  readonly agentId: AgentId;
  readonly status: RunState;
  readonly effectiveBindings: {
    readonly agentVersionId: AgentVersionId;
    readonly modelProfileVersionBindings: Readonly<Record<string, string>>;
  };
  readonly input: unknown;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly idempotencyKey?: string;
}

export interface RunAttemptResourceV1 {
  readonly id: RunAttemptId;
  readonly runId: RunId;
  readonly sequence: number;
  readonly status: RunAttemptState;
  readonly createdAt: string;
  readonly startedAt?: string;
  readonly completedAt?: string;
  readonly error?: {
    readonly code: string;
    readonly message: string;
  };
  readonly output?: JsonValue;
}

export interface CreateRunResponseV1 {
  readonly run: RunResourceV1;
  readonly runAttempt: RunAttemptResourceV1;
}

export interface RunListResourceV1 {
  readonly runs: readonly RunResourceV1[];
  readonly nextCursor?: string;
}

export interface RunAttemptListResourceV1 {
  readonly attempts: readonly RunAttemptResourceV1[];
}

export interface RunListCursorV1 {
  readonly createdAt: string;
  readonly id: RunId;
}
