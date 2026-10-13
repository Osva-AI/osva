import type {
  AgentId,
  AgentVersionId,
  RunAttemptId,
  RunId,
  WorkspaceId,
} from "./ids.js";
import type { JsonValue } from "./json-value.js";
import type { RunAttemptState, RunState } from "./run-state.js";

export const RUN_ATTEMPT_EXECUTION_STATES = [
  "queued",
  "running_leased",
  "running_lease_expired",
  "running_unleased",
  "interrupted",
  "failed",
  "completed",
  "cancelled",
  "timed_out",
] as const;

export type RunAttemptExecutionStateV1 =
  (typeof RUN_ATTEMPT_EXECUTION_STATES)[number];

export interface RunAttemptExecutionDiagnosticsV1 {
  readonly state: RunAttemptExecutionStateV1;
  readonly leased: boolean;
  readonly leaseExpiresAt?: string;
  readonly executionGeneration: number;
  readonly interrupted: boolean;
  readonly recoveryReason?: string;
  readonly observedAt: string;
}

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
    readonly toolVersionBindings: Readonly<Record<string, string>>;
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
  readonly execution?: RunAttemptExecutionDiagnosticsV1;
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
