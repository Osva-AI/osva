import type {
  ExecutionRequest,
  GenerateCompletionResult,
  JsonSchemaRecord,
  JsonValue,
  ToolVersionId,
} from "@osva-ai/contracts";
import {
  DeclarativeRuntimeAdapter,
  type DeclarativeRuntimeModelGateway,
  type DeclarativeRuntimeToolGateway,
  type DeclarativeToolMetadata,
} from "@osva/adapters-runtime-declarative";
import { crashIfRequested } from "@osva/adapters-runtime-declarative";

export interface CheckpointCrashInjectionCounters {
  modelInvocations: number;
  toolInvocations: number;
}

export function createCheckpointCrashInjectionRuntime(input: {
  readonly outputSchema: JsonSchemaRecord;
  readonly toolMetadata: DeclarativeToolMetadata;
  readonly toolVersionId: ToolVersionId;
  readonly bindingName: string;
  readonly modelSequence: readonly GenerateCompletionResult[];
  readonly toolResult: JsonValue;
  readonly counters: CheckpointCrashInjectionCounters;
}): DeclarativeRuntimeAdapter {
  let modelIndex = 0;

  const modelGateway: DeclarativeRuntimeModelGateway = {
    generateCompletion: async () => {
      input.counters.modelInvocations += 1;
      crashIfRequested("during_model_invocation");
      const next = input.modelSequence[modelIndex];
      modelIndex += 1;
      if (next === undefined) {
        return {
          text: JSON.stringify({ answer: "done" }),
          toolCalls: [],
          finishReason: "stop",
        };
      }
      return next;
    },
  };

  const toolGateway: DeclarativeRuntimeToolGateway = {
    invoke: async () => {
      input.counters.toolInvocations += 1;
      return input.toolResult;
    },
  };

  return new DeclarativeRuntimeAdapter({
    modelGateway,
    toolGateway,
    resolveToolMetadata: async () => input.toolMetadata,
  });
}

export function declarativeCheckpointOutputSchema(): JsonSchemaRecord {
  return {
    type: "object",
    properties: { answer: { type: "string" } },
    required: ["answer"],
    additionalProperties: false,
  };
}

export function buildToolCallCompletion(
  calls: ReadonlyArray<{
    readonly id: string;
    readonly name: string;
    readonly arguments: JsonValue;
  }>,
): GenerateCompletionResult {
  return {
    toolCalls: calls.map((call) => ({
      id: call.id,
      name: call.name,
      arguments: call.arguments,
    })),
    finishReason: "tool_call",
  };
}

export type { ExecutionRequest };
