import { BuilderProposalAnthropicRecordsJsonSchema } from "@osva/domain/builder";
import { afterEach, describe, expect, it } from "vitest";

import {
  ANTHROPIC_MESSAGES_API_VERSION,
  AnthropicProviderAdapter,
} from "../src/anthropic-provider-adapter.js";
import { startFakeAnthropicMessagesServer } from "./fake-anthropic-server.js";

const servers: Array<{ close(): Promise<void> }> = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

describe("Anthropic SDK wire serialization (offline)", () => {
  it("overrides default anthropic-version and forwards output_config body", async () => {
    const server = await startFakeAnthropicMessagesServer();
    servers.push(server);

    const adapter = new AnthropicProviderAdapter({
      apiKey: "test-key",
      baseURL: server.origin,
      maxRetries: 0,
      anthropicWorkspaceId: "wrkspc_01MockProbeWorkspace",
    });

    await adapter.generateText({
      model: "claude-sonnet-5-5",
      messages: [{ role: "user", content: "builder-m20-json-schema" }],
      jsonSchema: BuilderProposalAnthropicRecordsJsonSchema,
      maxOutputTokens: 2048,
    });

    expect(server.requests).toHaveLength(1);
    const headers = server.requests[0]?.headers ?? {};
    expect(headers["anthropic-version"]).toBe(ANTHROPIC_MESSAGES_API_VERSION);
    expect(headers["anthropic-workspace-id"]).toBeDefined();
    expect(
      String(headers["anthropic-workspace-id"]).startsWith("wrkspc_"),
    ).toBe(true);

    const body = server.requests[0]?.body as Record<string, unknown>;
    expect(body.model).toBe("claude-sonnet-5-5");
    expect(body.max_tokens).toBe(2048);
    expect(body.output_config).toBeDefined();
    expect(
      (body.output_config as { format?: { type?: string } }).format?.type,
    ).toBe("json_schema");
    expect(body).not.toHaveProperty("output_format");
    expect(body).not.toHaveProperty("temperature");
    expect(JSON.stringify(body)).not.toContain("test-key");
  });
});
