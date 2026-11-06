import type {
  DeclarativeAgentRuntime,
  DeclarativePendingToolCallV1,
  ExecutionRequest,
  ExecutionResult,
  GenerateCompletionRequest,
  JsonSchemaRecord,
  JsonValue,
  ModelConversationMessage,
  ModelToolDefinition,
  ToolVersionId,
} from "@osva-ai/contracts";
import {
  RECOVERY_BLOCKED_UNCERTAIN_OPERATION_CODE,
  isCanonicalJsonValue,
  isSideEffectSafeToAutoReplay,
  resolveRunOperationJournalFailureDisposition,
} from "@osva-ai/contracts";

import {
  buildDeclarativeCheckpointState,
  commitDeclarativeCheckpoint,
  isDeclarativeCheckpointingEnabled,
  toPendingToolCalls,
} from "./declarative-checkpoint.js";
import { crashIfRequested } from "./checkpoint-crash-hook.js";
import { buildDeclarativeContextUserContent } from "./declarative-context-prefetch.js";
import type {
  DeclarativeRuntimeKnowledgeGateway,
  DeclarativeRuntimeMemoryGateway,
} from "./declarative-context-prefetch.js";
import { DeclarativeRuntimeErrorCode } from "./constants.js";
import { validateJsonSchemaInstance } from "./json-schema-instance.js";
import type {
  DeclarativeRuntimeLogger,
  DeclarativeRuntimeModelGateway,
  DeclarativeRuntimeToolGateway,
} from "./declarative-runtime-adapter.js";
import {
  executionFailure,
  sanitizePublicErrorMessage,
} from "./public-error.js";
import {
  buildRunOperationKey,
  fingerprintToolInput,
} from "./run-operation-key.js";

interface DeclarativeToolMetadata {
  readonly inputSchema: JsonSchemaRecord;
  readonly idempotencyClass: import("@osva-ai/contracts").RunOperationIdempotencyClass;
}

export async function runDeclarativeExecutionLoop(input: {
  readonly request: ExecutionRequest;
  readonly config: DeclarativeAgentRuntime["config"];
  readonly modelProfileVersionId: GenerateCompletionRequest["modelProfileVersionId"];
  readonly allowedTools: ReadonlySet<string>;
  readonly outputSchema: JsonSchemaRecord;
  readonly modelGateway: DeclarativeRuntimeModelGateway;
  readonly toolGateway: DeclarativeRuntimeToolGateway | undefined;
  readonly knowledgeGateway: DeclarativeRuntimeKnowledgeGateway | undefined;
  readonly memoryGateway: DeclarativeRuntimeMemoryGateway | undefined;
  readonly signal: AbortSignal;
  readonly toolDefinitions: readonly ModelToolDefinition[];
  readonly resolveToolMetadata: (input: {
    readonly toolVersionId: ToolVersionId;
  }) => Promise<DeclarativeToolMetadata | null>;
  readonly logger: DeclarativeRuntimeLogger | undefined;
}): Promise<ExecutionResult> {
  const {
    request,
    config,
    modelProfileVersionId,
    allowedTools,
    outputSchema,
    modelGateway,
    toolGateway,
    knowledgeGateway,
    memoryGateway,
    signal,
    toolDefinitions,
    resolveToolMetadata,
  } = input;

  const checkpointEnabled = isDeclarativeCheckpointingEnabled(request);
  const restore = request.checkpoint?.restore;
  const ownership = request.executionOwnership;

  let modelInvocations = restore?.modelInvocations ?? 0;
  let toolInvocations = restore?.toolInvocations ?? 0;
  let checkpointSequence = 0;
  let retrievedContext = restore?.retrievedContext;

  let messages: ModelConversationMessage[];
  if (restore !== undefined && restore.messages.length > 0) {
    messages = [...restore.messages];
  } else {
    try {
      retrievedContext = await buildDeclarativeContextUserContent({
        request,
        knowledgeGateway,
        memoryGateway,
        logger: input.logger,
      });
    } catch (error) {
      const mapped = mapContextPrefetchFailure(error);
      return executionFailure(mapped.code, mapped.message);
    }

    const userContentParts = [
      formatUntrustedRunInput(request.input),
      retrievedContext,
    ].filter((part): part is string => part !== undefined);

    messages = [
      { role: "system", content: config.instructions },
      {
        role: "user",
        content: userContentParts.join("\n\n"),
      },
    ];

    if (checkpointEnabled && ownership !== undefined) {
      checkpointSequence += 1;
      await commitDeclarativeCheckpoint({
        request,
        executionGeneration: ownership.generation,
        executionOwner: ownership.owner,
        cursorPhase: "after_prefetch",
        checkpointSequence,
        state: buildDeclarativeCheckpointState({
          messages,
          modelInvocations,
          toolInvocations,
          retrievedContext,
        }),
        idempotencyKey: `${request.runAttemptId}:prefetch:${checkpointSequence}`,
      });
    }
  }

  let pendingToolCalls: DeclarativePendingToolCallV1[] | undefined =
    restore?.pendingToolCalls ? [...restore.pendingToolCalls] : undefined;

  while (true) {
    throwIfCancelled(signal);

    if (pendingToolCalls !== undefined && pendingToolCalls.length > 0) {
      const batch = pendingToolCalls;
      pendingToolCalls = undefined;
      const toolResult = await executeToolBatch({
        request,
        config,
        allowedTools,
        toolGateway,
        signal,
        messages,
        calls: batch,
        resolveToolMetadata,
        getToolInvocations: () => toolInvocations,
        setToolInvocations: (value) => {
          toolInvocations = value;
        },
      });
      if (toolResult.kind === "failure") {
        return toolResult.result;
      }

      if (checkpointEnabled && ownership !== undefined) {
        checkpointSequence += 1;
        await commitDeclarativeCheckpoint({
          request,
          executionGeneration: ownership.generation,
          executionOwner: ownership.owner,
          cursorPhase: "after_tool",
          checkpointSequence,
          state: buildDeclarativeCheckpointState({
            messages,
            modelInvocations,
            toolInvocations,
            retrievedContext,
          }),
          idempotencyKey: `${request.runAttemptId}:tool:${checkpointSequence}`,
        });
        crashIfRequested("after_tool_checkpoint");
      }
      continue;
    }

    if (modelInvocations >= config.maxModelInvocations) {
      return executionFailure(
        DeclarativeRuntimeErrorCode.BUDGET_EXCEEDED,
        "Maximum model invocations exceeded.",
      );
    }

    modelInvocations += 1;
    const useTools =
      toolDefinitions.length > 0 && toolInvocations < config.maxToolInvocations;

    const completion = await modelGateway.generateCompletion(
      {
        modelProfileVersionId,
        messages,
        maxOutputTokens: config.maxOutputTokens,
        toolDefinitions: useTools ? toolDefinitions : undefined,
        jsonSchema: useTools ? undefined : outputSchema,
      },
      { signal },
    );

    const toolCalls = completion.toolCalls ?? [];

    if (toolCalls.length > 0) {
      if (toolGateway === undefined) {
        return executionFailure(
          DeclarativeRuntimeErrorCode.TOOL_UNAVAILABLE,
          "Tool capability is unavailable.",
        );
      }

      messages.push({
        role: "assistant",
        content:
          completion.text ?? summarizeToolCallsForConversation(toolCalls),
      });

      if (checkpointEnabled && ownership !== undefined) {
        checkpointSequence += 1;
        await commitDeclarativeCheckpoint({
          request,
          executionGeneration: ownership.generation,
          executionOwner: ownership.owner,
          cursorPhase: "after_model",
          checkpointSequence,
          state: buildDeclarativeCheckpointState({
            messages,
            modelInvocations,
            toolInvocations,
            retrievedContext,
            pendingToolCalls: toPendingToolCalls(toolCalls),
          }),
          idempotencyKey: `${request.runAttemptId}:model:${checkpointSequence}`,
        });
      }

      for (let index = 0; index < toolCalls.length; index += 1) {
        const call = toolCalls[index]!;
        const remaining = toolCalls.slice(index + 1);

        const singleResult = await executeToolBatch({
          request,
          config,
          allowedTools,
          toolGateway,
          signal,
          messages,
          calls: [
            {
              id: call.id,
              name: call.name,
              arguments: call.arguments as JsonValue,
            },
          ],
          resolveToolMetadata,
          getToolInvocations: () => toolInvocations,
          setToolInvocations: (value) => {
            toolInvocations = value;
          },
        });
        if (singleResult.kind === "failure") {
          return singleResult.result;
        }

        if (checkpointEnabled && ownership !== undefined) {
          checkpointSequence += 1;
          await commitDeclarativeCheckpoint({
            request,
            executionGeneration: ownership.generation,
            executionOwner: ownership.owner,
            cursorPhase: "after_tool",
            checkpointSequence,
            state: buildDeclarativeCheckpointState({
              messages,
              modelInvocations,
              toolInvocations,
              retrievedContext,
              pendingToolCalls:
                remaining.length > 0
                  ? toPendingToolCalls(remaining)
                  : undefined,
            }),
            idempotencyKey: `${request.runAttemptId}:tool:${checkpointSequence}`,
          });
          crashIfRequested("after_tool_checkpoint");
        }
      }

      continue;
    }

    const rawOutput = parseStructuredOutput(completion.text);
    if (rawOutput === undefined) {
      return executionFailure(
        DeclarativeRuntimeErrorCode.INVALID_MODEL_RESPONSE,
        "Model returned an invalid structured response.",
      );
    }

    if (!isCanonicalJsonValue(rawOutput)) {
      return executionFailure(
        DeclarativeRuntimeErrorCode.INVALID_OUTPUT,
        "Runtime output must be JSON-compatible.",
      );
    }

    const outputValidation = validateJsonSchemaInstance(
      outputSchema,
      rawOutput,
    );
    if (!outputValidation.ok) {
      return executionFailure(
        DeclarativeRuntimeErrorCode.INVALID_OUTPUT,
        "Runtime output does not match the declared output schema.",
      );
    }

    if (checkpointEnabled && ownership !== undefined) {
      checkpointSequence += 1;
      await commitDeclarativeCheckpoint({
        request,
        executionGeneration: ownership.generation,
        executionOwner: ownership.owner,
        cursorPhase: "after_model",
        checkpointSequence,
        state: buildDeclarativeCheckpointState({
          messages,
          modelInvocations,
          toolInvocations,
          retrievedContext,
        }),
        idempotencyKey: `${request.runAttemptId}:complete:${checkpointSequence}`,
      });
    }

    return { status: "succeeded", output: rawOutput };
  }
}

async function executeToolBatch(input: {
  readonly request: ExecutionRequest;
  readonly config: DeclarativeAgentRuntime["config"];
  readonly allowedTools: ReadonlySet<string>;
  readonly toolGateway: DeclarativeRuntimeToolGateway | undefined;
  readonly signal: AbortSignal;
  readonly messages: ModelConversationMessage[];
  readonly calls: readonly DeclarativePendingToolCallV1[];
  readonly resolveToolMetadata: (input: {
    readonly toolVersionId: ToolVersionId;
  }) => Promise<DeclarativeToolMetadata | null>;
  readonly getToolInvocations: () => number;
  readonly setToolInvocations: (value: number) => void;
}): Promise<
  | { readonly kind: "ok" }
  | { readonly kind: "failure"; readonly result: ExecutionResult }
> {
  if (input.toolGateway === undefined) {
    return {
      kind: "failure",
      result: executionFailure(
        DeclarativeRuntimeErrorCode.TOOL_UNAVAILABLE,
        "Tool capability is unavailable.",
      ),
    };
  }

  for (const call of input.calls) {
    throwIfCancelled(input.signal);

    let toolInvocations = input.getToolInvocations();
    if (toolInvocations >= input.config.maxToolInvocations) {
      return {
        kind: "failure",
        result: executionFailure(
          DeclarativeRuntimeErrorCode.BUDGET_EXCEEDED,
          "Maximum tool invocations exceeded.",
        ),
      };
    }

    if (!input.allowedTools.has(call.name)) {
      return {
        kind: "failure",
        result: executionFailure(
          DeclarativeRuntimeErrorCode.TOOL_NOT_AUTHORIZED,
          "Model requested an unauthorized tool.",
        ),
      };
    }

    const toolVersionId = input.request.toolVersionBindings[call.name];
    if (toolVersionId === undefined) {
      return {
        kind: "failure",
        result: executionFailure(
          DeclarativeRuntimeErrorCode.BINDING_MISMATCH,
          "Tool binding is missing from effective bindings.",
        ),
      };
    }

    const metadata = await input.resolveToolMetadata({ toolVersionId });
    if (metadata === null) {
      return {
        kind: "failure",
        result: executionFailure(
          DeclarativeRuntimeErrorCode.TOOL_UNAVAILABLE,
          "Tool metadata was not found.",
        ),
      };
    }

    const inputValidation = validateJsonSchemaInstance(
      metadata.inputSchema,
      call.arguments,
    );
    if (!inputValidation.ok) {
      return {
        kind: "failure",
        result: executionFailure(
          DeclarativeRuntimeErrorCode.INVALID_TOOL_INPUT,
          "Tool arguments failed schema validation.",
        ),
      };
    }

    const journal = input.request.operationJournal;
    const operationKey = buildRunOperationKey(input.request.runId, call.id);
    const executionGeneration =
      input.request.executionOwnership?.generation ?? 1;

    let toolOutput: JsonValue | undefined;
    let resumePendingOperation = false;
    const inputFingerprint = fingerprintToolInput(call.arguments);
    if (journal !== undefined) {
      const existing = await journal.findByRunAndOperationKey(
        input.request.workspaceId,
        input.request.runId,
        operationKey,
      );
      if (
        existing?.status === "COMMITTED" &&
        existing.committedResult !== undefined &&
        isCanonicalJsonValue(existing.committedResult)
      ) {
        if (
          existing.toolVersionId !== toolVersionId ||
          existing.inputFingerprint !== inputFingerprint ||
          existing.bindingName !== call.name
        ) {
          return {
            kind: "failure",
            result: executionFailure(
              RECOVERY_BLOCKED_UNCERTAIN_OPERATION_CODE,
              "Committed operation journal entry does not match the restored tool call.",
            ),
          };
        }
        toolOutput = existing.committedResult;
      } else if (existing?.status === "UNCERTAIN") {
        return {
          kind: "failure",
          result: executionFailure(
            RECOVERY_BLOCKED_UNCERTAIN_OPERATION_CODE,
            "An external tool operation may have succeeded without a committed result.",
          ),
        };
      } else if (existing?.status === "PENDING") {
        if (
          existing.toolVersionId !== toolVersionId ||
          existing.inputFingerprint !== inputFingerprint ||
          existing.bindingName !== call.name
        ) {
          return {
            kind: "failure",
            result: executionFailure(
              RECOVERY_BLOCKED_UNCERTAIN_OPERATION_CODE,
              "Pending operation journal entry does not match the restored tool call.",
            ),
          };
        }
        if (
          !isSideEffectSafeToAutoReplay(existing.idempotencyClass, "PENDING")
        ) {
          return {
            kind: "failure",
            result: executionFailure(
              RECOVERY_BLOCKED_UNCERTAIN_OPERATION_CODE,
              "An external tool operation may have succeeded without a committed result.",
            ),
          };
        }
        resumePendingOperation = true;
      }
    }

    if (toolOutput === undefined) {
      toolInvocations += 1;
      input.setToolInvocations(toolInvocations);

      if (journal !== undefined && !resumePendingOperation) {
        await journal.recordPending({
          workspaceId: input.request.workspaceId,
          runId: input.request.runId,
          runAttemptId: input.request.runAttemptId,
          executionGeneration,
          operationKey,
          toolVersionId,
          bindingName: call.name,
          inputFingerprint,
          idempotencyClass: metadata.idempotencyClass,
        });
        crashIfRequested("after_operation_pending");
      }

      try {
        toolOutput = await input.toolGateway.invoke({
          toolVersionId,
          input: call.arguments,
          authorization: {
            workspaceId: input.request.workspaceId,
            agentId: input.request.agentId,
            runId: input.request.runId,
            runAttemptId: input.request.runAttemptId,
            bindingName: call.name,
            toolVersionId,
          },
        });
      } catch (error) {
        if (journal !== undefined) {
          const disposition = resolveRunOperationJournalFailureDisposition({
            idempotencyClass: metadata.idempotencyClass,
            error,
            pendingRecorded: true,
          });
          if (disposition.kind === "definitive_failed") {
            await journal.markFailed({
              workspaceId: input.request.workspaceId,
              runId: input.request.runId,
              operationKey,
            });
          } else if (disposition.kind === "uncertain") {
            await journal.markUncertain({
              workspaceId: input.request.workspaceId,
              runId: input.request.runId,
              operationKey,
            });
          }
        }
        const mapped = mapToolGatewayFailure(error);
        return {
          kind: "failure",
          result: executionFailure(mapped.code, mapped.message),
        };
      }

      if (!isCanonicalJsonValue(toolOutput)) {
        if (journal !== undefined) {
          await journal.markFailed({
            workspaceId: input.request.workspaceId,
            runId: input.request.runId,
            operationKey,
          });
        }
        return {
          kind: "failure",
          result: executionFailure(
            DeclarativeRuntimeErrorCode.INVALID_TOOL_INPUT,
            "Tool output must be JSON-compatible.",
          ),
        };
      }

      if (journal !== undefined) {
        const committed = await journal.commitResult({
          workspaceId: input.request.workspaceId,
          runId: input.request.runId,
          operationKey,
          committedResult: toolOutput,
        });
        if (committed === null) {
          await journal.markUncertain({
            workspaceId: input.request.workspaceId,
            runId: input.request.runId,
            operationKey,
          });
          return {
            kind: "failure",
            result: executionFailure(
              RECOVERY_BLOCKED_UNCERTAIN_OPERATION_CODE,
              "Tool result could not be committed to the operation journal.",
            ),
          };
        }
        crashIfRequested("after_tool_journal_commit");
      }
    } else {
      toolInvocations += 1;
      input.setToolInvocations(toolInvocations);
    }

    input.messages.push({
      role: "tool",
      toolCallId: call.id,
      name: call.name,
      content: JSON.stringify(toolOutput),
    });
  }

  return { kind: "ok" };
}

function throwIfCancelled(signal: AbortSignal): void {
  if (signal.aborted) {
    throw new Error(DeclarativeRuntimeErrorCode.CANCELLED);
  }
}

function formatUntrustedRunInput(input: unknown): string {
  try {
    return `Untrusted run input (JSON):\n${JSON.stringify(input)}`;
  } catch {
    return "Untrusted run input (non-JSON-serializable).";
  }
}

function summarizeToolCallsForConversation(
  toolCalls: ReadonlyArray<{ readonly name: string }>,
): string {
  const names = toolCalls.map((call) => call.name).join(", ");
  return `Requested tools: ${names}`;
}

function parseStructuredOutput(text: string | undefined): unknown {
  if (text === undefined || text.trim().length === 0) {
    return undefined;
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

function mapContextPrefetchFailure(error: unknown): {
  readonly code: string;
  readonly message: string;
} {
  if (error instanceof Error) {
    const code = (error as { code?: unknown }).code;
    if (
      typeof code === "string" &&
      (code === DeclarativeRuntimeErrorCode.KNOWLEDGE_UNAVAILABLE ||
        code === DeclarativeRuntimeErrorCode.MEMORY_UNAVAILABLE)
    ) {
      return {
        code,
        message: sanitizePublicErrorMessage(
          error.message,
          "Context retrieval failed.",
        ),
      };
    }
  }

  return {
    code: DeclarativeRuntimeErrorCode.KNOWLEDGE_UNAVAILABLE,
    message: "Context retrieval failed.",
  };
}

function mapToolGatewayFailure(error: unknown): {
  readonly code: string;
  readonly message: string;
} {
  if (error instanceof Error) {
    return {
      code: DeclarativeRuntimeErrorCode.TOOL_UNAVAILABLE,
      message: error.message,
    };
  }
  return {
    code: DeclarativeRuntimeErrorCode.TOOL_UNAVAILABLE,
    message: "Tool invocation failed.",
  };
}
