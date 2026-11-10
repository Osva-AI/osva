import { BuilderProposalAnthropicRecordsJsonSchema } from "@osva/domain/builder";
import { buildBuilderGenerationMessages } from "@osva/domain/builder";
import { describe, expect, it } from "vitest";

import { buildAnthropicMessagesCountTokensBody } from "../src/anthropic-count-tokens-body.js";

describe("buildAnthropicMessagesCountTokensBody", () => {
  it("omits max_tokens and mirrors Builder messages + projected schema", () => {
    const messages = buildBuilderGenerationMessages("{}", "smoke");
    const body = buildAnthropicMessagesCountTokensBody({
      model: "claude-sonnet-5-5",
      messages,
      jsonSchema: BuilderProposalAnthropicRecordsJsonSchema,
    });

    expect(body.model).toBe("claude-sonnet-5-5");
    expect(body).not.toHaveProperty("max_tokens");
    expect(body).not.toHaveProperty("stream");
    expect(body.system).toContain("builder proposal generator");
    expect(body.messages).toHaveLength(2);
    expect(
      (body.output_config as { format?: { type?: string } }).format?.type,
    ).toBe("json_schema");
    const schema = (
      body.output_config as { format?: { schema?: Record<string, unknown> } }
    ).format?.schema;
    expect(schema).toBeDefined();
    expect(JSON.stringify(schema)).not.toMatch(/"pattern"/);
  });
});
