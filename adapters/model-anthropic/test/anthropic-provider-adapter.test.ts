import { MODEL_ERROR_CODES } from "@osva/contracts";
import { afterEach, describe, expect, it } from "vitest";

import { AnthropicProviderAdapter } from "../src/anthropic-provider-adapter.js";
import { startFakeAnthropicMessagesServer } from "./fake-anthropic-server.js";

const servers: Array<{ close(): Promise<void> }> = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

describe("AnthropicProviderAdapter", () => {
  it("calls the Messages API with mapped system, roles, and max tokens", async () => {
    const server = await startFakeAnthropicMessagesServer();
    servers.push(server);
    const adapter = new AnthropicProviderAdapter({
      apiKey: "test-key",
      baseURL: server.origin,
      maxRetries: 0,
    });

    const result = await adapter.generateText({
      model: "claude-test-snapshot",
      messages: [
        { role: "system", content: "You are concise." },
        { role: "user", content: "Explain this concept." },
        { role: "assistant", content: "It is an operating layer." },
        { role: "user", content: "Continue." },
      ],
      maxOutputTokens: 64,
    });

    expect(result).toEqual({
      text: "normalized text from fake anthropic",
      usage: {
        inputTokens: 120,
        outputTokens: 15,
        totalTokens: 135,
        cachedInputTokens: 8,
      },
      finishReason: "stop",
      providerFinishReason: "end_turn",
      providerRequestId: "msg_ok",
    });
    expect(server.requests).toHaveLength(1);
    expect(server.requests[0]?.url).toBe("/v1/messages");
    expect(server.requests[0]?.body).toMatchObject({
      model: "claude-test-snapshot",
      system: "You are concise.",
      max_tokens: 64,
      messages: [
        { role: "user", content: "Explain this concept." },
        { role: "assistant", content: "It is an operating layer." },
        { role: "user", content: "Continue." },
      ],
    });
    expect(JSON.stringify(result)).not.toContain("test-key");
  });

  it("does not retry rate-limited requests with default SDK configuration", async () => {
    const server = await startFakeAnthropicMessagesServer();
    servers.push(server);
    const adapter = new AnthropicProviderAdapter({
      apiKey: "test-key",
      baseURL: server.origin,
    });

    await expect(
      adapter.generateText({
        model: "claude-test-snapshot",
        messages: [{ role: "user", content: "rate-limit" }],
      }),
    ).rejects.toMatchObject({
      code: MODEL_ERROR_CODES.MODEL_RATE_LIMITED,
      retryable: true,
      retryAfterMs: 2000,
    });

    expect(server.requests).toHaveLength(1);
  });

  it("normalizes authentication, rate-limit, not-found, and invalid output errors", async () => {
    const server = await startFakeAnthropicMessagesServer();
    servers.push(server);
    const adapter = new AnthropicProviderAdapter({
      apiKey: "test-key",
      baseURL: server.origin,
      maxRetries: 0,
    });

    await expect(
      adapter.generateText({
        model: "claude-test-snapshot",
        messages: [{ role: "user", content: "auth-fail" }],
      }),
    ).rejects.toMatchObject({
      code: MODEL_ERROR_CODES.MODEL_AUTHENTICATION_ERROR,
      retryable: false,
    });

    await expect(
      adapter.generateText({
        model: "claude-test-snapshot",
        messages: [{ role: "user", content: "rate-limit" }],
      }),
    ).rejects.toMatchObject({
      code: MODEL_ERROR_CODES.MODEL_RATE_LIMITED,
      retryable: true,
      retryAfterMs: 2000,
    });

    await expect(
      adapter.generateText({
        model: "claude-test-snapshot",
        messages: [{ role: "user", content: "not-found" }],
      }),
    ).rejects.toMatchObject({
      code: MODEL_ERROR_CODES.MODEL_NOT_FOUND,
      retryable: false,
    });

    await expect(
      adapter.generateText({
        model: "claude-test-snapshot",
        messages: [{ role: "user", content: "invalid-request" }],
      }),
    ).rejects.toMatchObject({
      code: MODEL_ERROR_CODES.MODEL_INVALID_REQUEST,
      retryable: false,
    });

    await expect(
      adapter.generateText({
        model: "claude-test-snapshot",
        messages: [{ role: "user", content: "empty" }],
      }),
    ).rejects.toMatchObject({
      code: MODEL_ERROR_CODES.INVALID_MODEL_RESPONSE,
    });
  });

  it("normalizes finish reasons and tool-use stop reasons", async () => {
    const server = await startFakeAnthropicMessagesServer();
    servers.push(server);
    const adapter = new AnthropicProviderAdapter({
      apiKey: "test-key",
      baseURL: server.origin,
      maxRetries: 0,
    });

    const result = await adapter.generateText({
      model: "claude-test-snapshot",
      messages: [{ role: "user", content: "tool-use" }],
    });

    expect(result.finishReason).toBe("tool_call");
    expect(result.providerFinishReason).toBe("tool_use");
    expect(result.text).toBe("partial tool output");
  });

  it("normalizes provider network errors and cancellation", async () => {
    const server = await startFakeAnthropicMessagesServer();
    servers.push(server);
    const adapter = new AnthropicProviderAdapter({
      apiKey: "test-key",
      baseURL: "http://127.0.0.1:1",
      maxRetries: 0,
      timeout: 250,
    });

    await expect(
      adapter.generateText({
        model: "claude-test-snapshot",
        messages: [{ role: "user", content: "hello" }],
      }),
    ).rejects.toMatchObject({
      code: MODEL_ERROR_CODES.MODEL_PROVIDER_ERROR,
      retryable: true,
    });

    const hangingAdapter = new AnthropicProviderAdapter({
      apiKey: "test-key",
      baseURL: server.origin,
      maxRetries: 0,
      timeout: 20,
    });
    const controller = new AbortController();
    const pending = hangingAdapter.generateText({
      model: "claude-test-snapshot",
      messages: [{ role: "user", content: "hang" }],
      signal: controller.signal,
    });
    controller.abort();

    await expect(pending).rejects.toMatchObject({
      code: MODEL_ERROR_CODES.MODEL_CANCELLED,
      retryable: false,
    });
  });

  it("rejects malformed provider responses", async () => {
    const server = await startFakeAnthropicMessagesServer();
    servers.push(server);
    const adapter = new AnthropicProviderAdapter({
      apiKey: "test-key",
      baseURL: server.origin,
      maxRetries: 0,
    });

    await expect(
      adapter.generateText({
        model: "claude-test-snapshot",
        messages: [{ role: "user", content: "malformed" }],
      }),
    ).rejects.toMatchObject({
      code: MODEL_ERROR_CODES.INVALID_MODEL_RESPONSE,
    });
  });
});
