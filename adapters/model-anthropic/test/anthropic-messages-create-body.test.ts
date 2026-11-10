import {
  BuilderProposalAnthropicRecordsJsonSchema,
  buildBuilderGenerationMessages,
} from "@osva/domain/builder";
import { afterEach, describe, expect, it } from "vitest";

import {
  ANTHROPIC_MESSAGES_OMITTED_SAMPLING_KEYS,
  buildAnthropicMessagesCreateBody,
} from "../src/anthropic-messages-create-body.js";
import { AnthropicProviderAdapter } from "../src/anthropic-provider-adapter.js";
import { startFakeAnthropicMessagesServer } from "./fake-anthropic-server.js";

const servers: Array<{ close(): Promise<void> }> = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

const BUILDER_CATALOG_JSON = JSON.stringify({
  schemaVersion: "1",
  models: [],
  tools: [],
});

const BUILDER_INSTRUCTION =
  "Create a workflow that summarizes weekly product feedback. The agent should identify recurring themes, highlight critical issues, and produce actionable recommendations. Do not use external tools.";

describe("buildAnthropicMessagesCreateBody", () => {
  it("projects the full Builder schema and omits unsupported sampling keys", () => {
    const messages = buildBuilderGenerationMessages(
      BUILDER_CATALOG_JSON,
      BUILDER_INSTRUCTION,
    );
    const body = buildAnthropicMessagesCreateBody({
      model: "claude-sonnet-5-5",
      messages,
      maxOutputTokens: 2048,
      jsonSchema: BuilderProposalAnthropicRecordsJsonSchema,
    });

    expect(body.model).toBe("claude-sonnet-5-5");
    expect(body.max_tokens).toBe(2048);
    expect(typeof body.system).toBe("string");
    expect(body.system).toContain("builder proposal generator");
    expect(body.messages).toHaveLength(2);
    expect(body.output_config).toEqual({
      format: {
        type: "json_schema",
        schema: expect.any(Object),
      },
    });
    expect(JSON.stringify(body.output_config)).not.toMatch(/"pattern"/);
    for (const key of ANTHROPIC_MESSAGES_OMITTED_SAMPLING_KEYS) {
      expect(body).not.toHaveProperty(key);
    }
    expect(JSON.stringify(body)).not.toContain("sk-");
  });

  it("matches the SDK-serialized Messages body for production Builder inputs", async () => {
    const server = await startFakeAnthropicMessagesServer();
    servers.push(server);

    const messages = buildBuilderGenerationMessages(
      BUILDER_CATALOG_JSON,
      BUILDER_INSTRUCTION,
    );
    const request = {
      model: "claude-sonnet-5-5",
      messages,
      maxOutputTokens: 2048,
      jsonSchema: BuilderProposalAnthropicRecordsJsonSchema,
    };
    const expected = buildAnthropicMessagesCreateBody(request);

    const adapter = new AnthropicProviderAdapter({
      apiKey: "test-key",
      baseURL: server.origin,
      maxRetries: 0,
    });
    await adapter.generateText(request);

    expect(server.requests).toHaveLength(1);
    expect(server.requests[0]?.url).toBe("/v1/messages");
    expect(server.requests[0]?.method).toBe("POST");
    expect(server.requests[0]?.body).toEqual(expected);
    expect(JSON.stringify(server.requests[0]?.body)).not.toContain("test-key");
    const headers = server.requests[0]?.headers ?? {};
    expect(headers["anthropic-version"]).toBe("2026-10-21");
    expect(headers["x-api-key"]).toBe("test-key");
    expect(String(headers["user-agent"] ?? "")).toMatch(/Anthropic\/JS/);
    expect(headers["x-stainless-package-version"]).toBeDefined();
  });
});
