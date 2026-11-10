import type {
  JsonSchemaRecord,
  ModelConversationMessage,
} from "@osva-ai/contracts";

import { buildAnthropicMessagesCreateBody } from "./anthropic-messages-create-body.js";

export interface AnthropicMessagesCountTokensBodyInput {
  readonly model: string;
  readonly messages: readonly ModelConversationMessage[];
  readonly jsonSchema?: JsonSchemaRecord;
}

/**
 * Body for POST /v1/messages/count_tokens — mirrors Builder generation wire minus
 * billable generation-only fields (max_tokens, tools, streaming, etc.).
 */
export function buildAnthropicMessagesCountTokensBody(
  input: AnthropicMessagesCountTokensBodyInput,
): Record<string, unknown> {
  const created = buildAnthropicMessagesCreateBody({
    model: input.model,
    messages: input.messages,
    jsonSchema: input.jsonSchema,
  });

  const body: Record<string, unknown> = {
    model: created.model,
    messages: created.messages,
  };
  if (created.system !== undefined) {
    body.system = created.system;
  }
  if (created.output_config !== undefined) {
    body.output_config = created.output_config;
  }
  return body;
}
