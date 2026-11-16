import type { Usage } from "@anthropic-ai/sdk/resources/messages/messages";
import { afterEach, describe, expect, it } from "vitest";

import { AnthropicProviderAdapter } from "../src/anthropic-provider-adapter.js";
import { normalizeAnthropicMessagesUsage } from "../src/anthropic-usage.js";
import { startFakeAnthropicMessagesServer } from "./fake-anthropic-server.js";

const servers: Array<{ close(): Promise<void> }> = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

describe("anthropic usage normalization", () => {
  it("sums uncached input, cache writes, and cache reads without double-counting", () => {
    expect(
      normalizeAnthropicMessagesUsage({
        input_tokens: 30,
        cache_creation_input_tokens: 20,
        cache_read_input_tokens: 100,
        output_tokens: 25,
      } as Usage),
    ).toEqual({
      inputTokens: 150,
      outputTokens: 25,
      totalTokens: 175,
      cachedInputTokens: 100,
      cacheWriteInputTokens: 20,
    });
  });

  it("returns undefined when usage is absent", () => {
    expect(normalizeAnthropicMessagesUsage(undefined)).toBeUndefined();
  });

  it("marks partial usage incomplete", () => {
    expect(
      normalizeAnthropicMessagesUsage({
        input_tokens: 10,
      } as Parameters<typeof normalizeAnthropicMessagesUsage>[0]),
    ).toMatchObject({ incomplete: true });
  });

  it("accepts genuine zero-valued usage", () => {
    expect(
      normalizeAnthropicMessagesUsage({
        input_tokens: 0,
        output_tokens: 0,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 0,
      } as Usage),
    ).toEqual({
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
    });
  });
});

describe("AnthropicProviderAdapter provenance", () => {
  async function adapter(): Promise<AnthropicProviderAdapter> {
    const server = await startFakeAnthropicMessagesServer();
    servers.push(server);
    return new AnthropicProviderAdapter({
      apiKey: "test-key",
      baseURL: server.origin,
      maxRetries: 0,
    });
  }

  it("retains provider-reported model and response id", async () => {
    const client = await adapter();
    const result = await client.generateText({
      model: "claude-requested",
      messages: [{ role: "user", content: "Explain this concept." }],
    });

    expect(result.providerRequestId).toBe("msg_ok");
    expect(result.invocation).toEqual({
      configuredProviderModelId: "claude-requested",
      providerReportedModelId: "claude-3-5-sonnet-20241022",
    });
    expect(JSON.stringify(result)).not.toContain("test-key");
  });

  it("omits provider-reported model when absent", async () => {
    const client = await adapter();
    const result = await client.generateText({
      model: "claude-requested",
      messages: [{ role: "user", content: "provenance-no-model" }],
    });

    expect(result.invocation).toEqual({
      configuredProviderModelId: "claude-requested",
    });
  });

  it("omits usage when the provider response has no usage block", async () => {
    const client = await adapter();
    const result = await client.generateText({
      model: "claude-requested",
      messages: [{ role: "user", content: "provenance-no-usage" }],
    });

    expect(result.usage).toBeUndefined();
    expect(result.invocation?.providerReportedModelId).toBe("claude-reported");
  });

  it("normalizes mixed cache read, write and uncached input", async () => {
    const client = await adapter();
    const result = await client.generateText({
      model: "claude-requested",
      messages: [{ role: "user", content: "provenance-cache-mixed" }],
    });

    expect(result.usage).toEqual({
      inputTokens: 150,
      outputTokens: 25,
      totalTokens: 175,
      cachedInputTokens: 100,
      cacheWriteInputTokens: 20,
    });
  });

  it("keeps tool-call compatibility", async () => {
    const client = await adapter();
    const result = await client.generateText({
      model: "claude-test-snapshot",
      messages: [{ role: "user", content: "tool-use" }],
    });

    expect(result.finishReason).toBe("tool_call");
    expect(result.text).toBe("partial tool output");
  });
});
