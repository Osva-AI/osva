import type {
  AgentVersionId,
  RunAttemptId,
  RunId,
  WorkspaceId,
} from "./ids.js";
import type { JsonValue } from "./json-value.js";
import type { ModelConversationMessage } from "./model-gateway.js";

/** Version of the persisted run-checkpoint envelope (not runtime state). */
export const RUN_CHECKPOINT_ENVELOPE_VERSION = "1" as const;

export type RunCheckpointEnvelopeVersion =
  typeof RUN_CHECKPOINT_ENVELOPE_VERSION;

export const DECLARATIVE_CHECKPOINT_STATE_SCHEMA_VERSION = "1" as const;

export type DeclarativeCheckpointStateSchemaVersion =
  typeof DECLARATIVE_CHECKPOINT_STATE_SCHEMA_VERSION;

/** Maximum serialized checkpoint state JSON size (bytes). */
export const RUN_CHECKPOINT_MAX_STATE_BYTES = 512 * 1024;

export const RUN_CHECKPOINT_MAX_HISTORY_PER_RUN = 64;

export interface RunCheckpointBindingIdentity {
  readonly agentVersionId: AgentVersionId;
  readonly modelProfileVersionBindings: Readonly<Record<string, string>>;
  readonly toolVersionBindings: Readonly<Record<string, string>>;
}

export interface RunCheckpointCursorV1 {
  readonly phase: "after_model" | "after_tool" | "after_prefetch";
  readonly checkpointSequence: number;
}

export interface DeclarativePendingToolCallV1 {
  readonly id: string;
  readonly name: string;
  readonly arguments: JsonValue;
}

/**
 * Declarative runtime execution snapshot. JSON-serializable; no process memory.
 */
export interface DeclarativeRuntimeCheckpointStateV1 {
  readonly schemaVersion: DeclarativeCheckpointStateSchemaVersion;
  readonly messages: readonly ModelConversationMessage[];
  readonly modelInvocations: number;
  readonly toolInvocations: number;
  readonly retrievedContext?: string;
  readonly pendingToolCalls?: readonly DeclarativePendingToolCallV1[];
}

export interface RunCheckpointRecordV1 {
  readonly id: string;
  readonly workspaceId: WorkspaceId;
  readonly runId: RunId;
  readonly sequence: number;
  readonly runAttemptId: RunAttemptId;
  readonly executionGeneration: number;
  readonly runtimeKind: "DECLARATIVE";
  readonly envelopeVersion: RunCheckpointEnvelopeVersion;
  readonly stateSchemaVersion: DeclarativeCheckpointStateSchemaVersion;
  readonly bindingIdentity: RunCheckpointBindingIdentity;
  readonly bindingDigest: string;
  readonly cursor: RunCheckpointCursorV1;
  readonly state: DeclarativeRuntimeCheckpointStateV1;
  readonly payloadDigest: string;
  readonly createdAt: string;
}

export interface CommitRunCheckpointCommand {
  readonly workspaceId: WorkspaceId;
  readonly runId: RunId;
  readonly runAttemptId: RunAttemptId;
  readonly executionGeneration: number;
  readonly executionOwner: string;
  readonly runtimeKind: "DECLARATIVE";
  readonly bindingIdentity: RunCheckpointBindingIdentity;
  readonly cursor: RunCheckpointCursorV1;
  readonly state: DeclarativeRuntimeCheckpointStateV1;
  readonly idempotencyKey: string;
}

export type CommitRunCheckpointResult =
  | {
      readonly outcome: "committed";
      readonly checkpoint: RunCheckpointRecordV1;
    }
  | {
      readonly outcome: "duplicate";
      readonly checkpoint: RunCheckpointRecordV1;
    }
  | { readonly outcome: "stale_generation" }
  | { readonly outcome: "payload_too_large" }
  | { readonly outcome: "invalid_state" };

export interface RunCheckpointPort {
  commit(
    command: CommitRunCheckpointCommand,
  ): Promise<CommitRunCheckpointResult>;
}

export const CHECKPOINT_INCOMPATIBLE_ERROR_CODE = "CHECKPOINT_INCOMPATIBLE";
export const CHECKPOINT_CORRUPT_ERROR_CODE = "CHECKPOINT_CORRUPT";
