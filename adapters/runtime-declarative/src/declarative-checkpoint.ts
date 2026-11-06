import type {
  CommitRunCheckpointCommand,
  DeclarativePendingToolCallV1,
  DeclarativeRuntimeCheckpointStateV1,
  ExecutionRequest,
  JsonValue,
  ModelConversationMessage,
  RunCheckpointBindingIdentity,
  RunCheckpointCursorV1,
} from "@osva-ai/contracts";
import { DECLARATIVE_CHECKPOINT_STATE_SCHEMA_VERSION } from "@osva-ai/contracts";
import type { ModelToolCall } from "@osva-ai/contracts";

export function isDeclarativeCheckpointingEnabled(
  request: ExecutionRequest,
): boolean {
  if (request.runtime.type !== "DECLARATIVE") {
    return false;
  }
  if (request.checkpoint === undefined) {
    return false;
  }
  return request.runtime.config.checkpointingEnabled === true;
}

export function buildCheckpointBindingIdentity(
  request: ExecutionRequest,
): RunCheckpointBindingIdentity {
  return {
    agentVersionId: request.agentVersionId,
    modelProfileVersionBindings: { ...request.modelProfileVersionBindings },
    toolVersionBindings: { ...request.toolVersionBindings },
  };
}

export function buildDeclarativeCheckpointState(input: {
  readonly messages: readonly ModelConversationMessage[];
  readonly modelInvocations: number;
  readonly toolInvocations: number;
  readonly retrievedContext?: string;
  readonly pendingToolCalls?: readonly DeclarativePendingToolCallV1[];
}): DeclarativeRuntimeCheckpointStateV1 {
  return {
    schemaVersion: DECLARATIVE_CHECKPOINT_STATE_SCHEMA_VERSION,
    messages: input.messages,
    modelInvocations: input.modelInvocations,
    toolInvocations: input.toolInvocations,
    retrievedContext: input.retrievedContext,
    pendingToolCalls: input.pendingToolCalls,
  };
}

export function toPendingToolCalls(
  calls: readonly ModelToolCall[],
): readonly DeclarativePendingToolCallV1[] {
  return calls.map((call) => ({
    id: call.id,
    name: call.name,
    arguments: call.arguments as JsonValue,
  }));
}

export async function commitDeclarativeCheckpoint(input: {
  readonly request: ExecutionRequest;
  readonly executionGeneration: number;
  readonly executionOwner: string;
  readonly cursorPhase: RunCheckpointCursorV1["phase"];
  readonly checkpointSequence: number;
  readonly state: DeclarativeRuntimeCheckpointStateV1;
  readonly idempotencyKey: string;
}): Promise<void> {
  const port = input.request.checkpoint?.port;
  if (port === undefined) {
    return;
  }

  const command: CommitRunCheckpointCommand = {
    workspaceId: input.request.workspaceId,
    runId: input.request.runId,
    runAttemptId: input.request.runAttemptId,
    executionGeneration: input.executionGeneration,
    executionOwner: input.executionOwner,
    runtimeKind: "DECLARATIVE",
    bindingIdentity: buildCheckpointBindingIdentity(input.request),
    cursor: {
      phase: input.cursorPhase,
      checkpointSequence: input.checkpointSequence,
    },
    state: input.state,
    idempotencyKey: input.idempotencyKey,
  };

  const result = await port.commit(command);
  if (
    result.outcome === "stale_generation" ||
    result.outcome === "invalid_state" ||
    result.outcome === "payload_too_large"
  ) {
    throw new Error(`Checkpoint commit rejected: ${result.outcome}`);
  }
}
