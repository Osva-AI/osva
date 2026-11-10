import type {
  JsonSchemaRecord,
  ModelConversationMessage,
  ModelToolDefinition,
} from "@osva-ai/contracts";
import { splitSystemAndConversationMessages } from "@osva/model-gateway";
import type { MessageParam } from "@anthropic-ai/sdk/resources/messages/messages";

import type { AnthropicMessageCreateParamsWithStructuredOutput } from "./anthropic-messages-api.js";
import { projectJsonSchemaForAnthropicOutput } from "./anthropic-response-json-schema-projection.js";

export const ANTHROPIC_MESSAGES_OMITTED_SAMPLING_KEYS = [
  "temperature",
  "top_p",
  "top_k",
  "output_format",
] as const;

export interface AnthropicMessagesCreateBodyInput {
  readonly model: string;
  readonly messages: readonly ModelConversationMessage[];
  readonly maxOutputTokens?: number;
  readonly jsonSchema?: JsonSchemaRecord;
  readonly toolDefinitions?: readonly ModelToolDefinition[];
}

/**
 * Canonical Messages create body for the Builder structured-output path.
 * Shared by the SDK adapter and the operator raw-fetch diagnostic.
 */
export function buildAnthropicMessagesCreateBody(
  input: AnthropicMessagesCreateBodyInput,
): AnthropicMessageCreateParamsWithStructuredOutput {
  const { systemContent, conversation } = splitSystemAndConversationMessages(
    input.messages,
  );
  const params: AnthropicMessageCreateParamsWithStructuredOutput = {
    model: input.model,
    max_tokens: input.maxOutputTokens ?? 1024,
    messages: conversation.map(toAnthropicMessage),
  };

  if (systemContent.length > 0) {
    params.system = systemContent;
  }

  if (input.toolDefinitions !== undefined && input.toolDefinitions.length > 0) {
    params.tools = input.toolDefinitions.map((tool) => ({
      name: tool.name,
      description: tool.description,
      input_schema: {
        type: "object",
        ...tool.inputSchema,
      },
    }));
  }

  if (input.jsonSchema !== undefined) {
    params.output_config = {
      format: {
        type: "json_schema",
        schema: projectJsonSchemaForAnthropicOutput(input.jsonSchema),
      },
    };
  }

  return params;
}

export function toAnthropicMessage(
  message: ModelConversationMessage,
): MessageParam {
  if (message.role === "tool") {
    return {
      role: "user",
      content: [
        {
          type: "tool_result",
          tool_use_id: message.toolCallId,
          content: message.content,
        },
      ],
    };
  }

  return {
    role: message.role === "assistant" ? "assistant" : "user",
    content: message.content,
  };
}
