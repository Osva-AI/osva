import type { InferenceModelInvocationSource } from "./inference-cache.js";
import {
  isModelFinishReason,
  type GenerateCompletionResult,
  type ModelToolCall,
} from "./model-gateway.js";
import {
  MODEL_STREAM_EVENT_FORMAT_VERSION,
  MODEL_STREAM_MAX_EVENT_COUNT,
  MODEL_STREAM_MAX_TEXT_DELTA_BYTES,
  MODEL_STREAM_MAX_TOOL_ARGUMENT_BYTES,
  type ModelStreamAssemblyFailure,
  type ModelStreamAssemblyOutcome,
  type ModelStreamEvent,
  isModelStreamTerminalKind,
} from "./model-streaming.js";
import { modelToolCallSchema } from "./schemas/model-gateway.js";
import { utf8ByteLength } from "./utf8-byte-length.js";

type ToolAssemblyState = {
  readonly id: string;
  readonly name: string;
  readonly argumentFragments: string[];
  completeArguments?: unknown;
};

function fail(
  reason: ModelStreamAssemblyFailure["reason"],
  extra: Pick<ModelStreamAssemblyFailure, "code" | "message"> = {},
): ModelStreamAssemblyFailure {
  return { ok: false, reason, ...extra };
}

/**
 * Validates ordering and reconstructs a terminal {@link GenerateCompletionResult}
 * from a completed event sequence. Does not persist or emit metrics.
 */
export function assembleModelStreamCompletion(
  events: readonly ModelStreamEvent[],
): ModelStreamAssemblyOutcome {
  if (events.length === 0) {
    return fail("EMPTY_EVENT_LIST");
  }
  if (events.length > MODEL_STREAM_MAX_EVENT_COUNT) {
    return fail("TOO_MANY_EVENTS");
  }

  let expectedSequence = 0;
  let streamId: string | undefined;
  let text = "";
  let usage: GenerateCompletionResult["usage"];
  let invocationSource: InferenceModelInvocationSource | undefined;
  let providerRequestId: string | undefined;
  const tools = new Map<number, ToolAssemblyState>();
  let terminal: ModelStreamEvent | undefined;
  let usageSeen = false;
  let sawTerminal = false;

  for (const event of events) {
    if (event.streamFormatVersion !== MODEL_STREAM_EVENT_FORMAT_VERSION) {
      return fail("UNSUPPORTED_FORMAT_VERSION");
    }
    if (streamId === undefined) {
      streamId = event.streamId;
    } else if (event.streamId !== streamId) {
      return fail("INVALID_TOOL_CALL_SEQUENCE");
    }
    if (event.sequence !== expectedSequence) {
      return fail("SEQUENCE_OUT_OF_ORDER");
    }
    expectedSequence += 1;

    if (sawTerminal) {
      return fail("TERMINAL_NOT_LAST");
    }

    if (event.kind === "FAILED") {
      sawTerminal = true;
      terminal = event;
      return fail("STREAM_FAILED", {
        code: event.code,
        message: event.message,
      });
    }

    if (event.kind === "CANCELLED") {
      sawTerminal = true;
      terminal = event;
      return fail("STREAM_CANCELLED");
    }

    if (event.kind === "COMPLETED") {
      sawTerminal = true;
      terminal = event;
      continue;
    }

    if (isModelStreamTerminalKind(event.kind)) {
      return fail("UNSUPPORTED_EVENT_KIND");
    }

    switch (event.kind) {
      case "TEXT_DELTA": {
        if (event.textDelta.length === 0) {
          break;
        }
        if (
          utf8ByteLength(event.textDelta) > MODEL_STREAM_MAX_TEXT_DELTA_BYTES
        ) {
          return fail("TEXT_DELTA_TOO_LARGE");
        }
        text += event.textDelta;
        break;
      }
      case "TOOL_CALL_START": {
        if (tools.has(event.toolCallIndex)) {
          return fail("INVALID_TOOL_CALL_SEQUENCE");
        }
        tools.set(event.toolCallIndex, {
          id: event.toolCallId,
          name: event.name,
          argumentFragments: [],
        });
        break;
      }
      case "TOOL_CALL_ARGUMENTS_DELTA": {
        const tool = tools.get(event.toolCallIndex);
        if (tool === undefined) {
          return fail("INVALID_TOOL_CALL_SEQUENCE");
        }
        const accumulated =
          tool.argumentFragments.join("") + event.argumentsDelta;
        if (
          utf8ByteLength(accumulated) > MODEL_STREAM_MAX_TOOL_ARGUMENT_BYTES
        ) {
          return fail("TOOL_ARGUMENTS_TOO_LARGE");
        }
        tool.argumentFragments.push(event.argumentsDelta);
        break;
      }
      case "TOOL_CALL_COMPLETE": {
        const tool = tools.get(event.toolCallIndex);
        if (tool === undefined) {
          return fail("INVALID_TOOL_CALL_SEQUENCE");
        }
        tool.completeArguments = event.arguments;
        break;
      }
      case "USAGE_FINAL": {
        if (usageSeen) {
          return fail("DUPLICATE_USAGE");
        }
        usageSeen = true;
        usage = event.usage;
        invocationSource = event.invocationSource;
        providerRequestId = event.providerRequestId ?? providerRequestId;
        break;
      }
      default:
        return fail("UNSUPPORTED_EVENT_KIND");
    }
  }

  if (terminal === undefined || terminal.kind !== "COMPLETED") {
    return fail("MISSING_TERMINAL");
  }

  if (!isModelFinishReason(terminal.finishReason)) {
    return fail("PARTIAL_SUCCESS_REJECTED");
  }

  const toolCalls = materializeToolCalls(tools);
  if (toolCalls === undefined) {
    return fail("INVALID_TOOL_ARGUMENTS");
  }

  const hasText = text.trim().length > 0;
  const hasTools = toolCalls.length > 0;
  if (!hasText && !hasTools) {
    return fail("PARTIAL_SUCCESS_REJECTED");
  }

  const result: GenerateCompletionResult = {
    text: hasText ? text : undefined,
    toolCalls,
    finishReason: terminal.finishReason,
    usage,
  };

  return {
    ok: true,
    result,
    usage,
    invocationSource,
    providerRequestId: terminal.providerRequestId ?? providerRequestId,
  };
}

function materializeToolCalls(
  tools: Map<number, ToolAssemblyState>,
): readonly ModelToolCall[] | undefined {
  const ordered = [...tools.entries()].sort(([a], [b]) => a - b);
  const out: ModelToolCall[] = [];

  for (const [, tool] of ordered) {
    let args: unknown;
    if (tool.completeArguments !== undefined) {
      args = tool.completeArguments;
    } else {
      const raw = tool.argumentFragments.join("");
      if (raw.length === 0) {
        return undefined;
      }
      try {
        args = JSON.parse(raw) as unknown;
      } catch {
        return undefined;
      }
    }

    const candidate: ModelToolCall = {
      id: tool.id,
      name: tool.name,
      arguments: args,
    };
    const parsed = modelToolCallSchema.safeParse(candidate);
    if (!parsed.success) {
      return undefined;
    }
    out.push(parsed.data);
  }

  return out;
}
