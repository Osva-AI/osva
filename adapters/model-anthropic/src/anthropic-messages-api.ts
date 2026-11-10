import type { JsonSchemaRecord } from "@osva-ai/contracts";
import type { MessageCreateParamsNonStreaming } from "@anthropic-ai/sdk/resources/messages/messages";

/**
 * Structured outputs on Messages API (`output_config.format`).
 * The installed SDK types may lag the API; keep the wire shape explicit here.
 */
export type AnthropicMessageCreateParamsWithStructuredOutput =
  MessageCreateParamsNonStreaming & {
    readonly output_config?: {
      readonly format: {
        readonly type: "json_schema";
        readonly schema: JsonSchemaRecord;
      };
    };
  };
