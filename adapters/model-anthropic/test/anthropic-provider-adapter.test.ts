import { MODEL_ERROR_CODES } from "@osva-ai/contracts";
import { BuilderProposalOpenAiJsonSchema } from "@osva/domain/builder";
import { afterEach, describe, expect, it } from "vitest";

import {
  ANTHROPIC_MESSAGES_API_VERSION,
  AnthropicProviderAdapter,
} from "../src/anthropic-provider-adapter.js";
import { projectJsonSchemaForAnthropicOutput } from "../src/anthropic-response-json-schema-projection.js";
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
      providerErrorType: "invalid_request_error",
      providerRequestId: "req_invalid_400",
    });

    await expect(
      adapter.generateText({
        model: "claude-sonnet-5-5",
        messages: [{ role: "user", content: "invalid-json-schema" }],
        jsonSchema: BuilderProposalOpenAiJsonSchema,
      }),
    ).rejects.toMatchObject({
      code: MODEL_ERROR_CODES.MODEL_INVALID_REQUEST,
      providerErrorType: "invalid_request_error",
      providerErrorCode: "unsupported_schema_feature",
      providerErrorParam: "output_config.format.schema",
      providerRequestId: "req_schema_400",
    });

    await expect(
      adapter.generateText({
        model: "claude-sonnet-5-5",
        messages: [{ role: "user", content: "workspace-id-required" }],
      }),
    ).rejects.toMatchObject({
      code: MODEL_ERROR_CODES.MODEL_INVALID_REQUEST,
      providerErrorCode: "workspace_selection_required",
      providerErrorParam: "anthropic-workspace-id",
      providerRequestId: "req_workspace_400",
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

  it("sends anthropic-workspace-id when configured on the adapter", async () => {
    const server = await startFakeAnthropicMessagesServer();
    servers.push(server);
    const adapter = new AnthropicProviderAdapter({
      apiKey: "test-key",
      baseURL: server.origin,
      maxRetries: 0,
      anthropicWorkspaceId: "wrkspc_01TESTworkspace0001",
    });

    await adapter.generateText({
      model: "claude-sonnet-5-5",
      messages: [{ role: "user", content: "hello" }],
    });

    expect(server.requests[0]?.headers["anthropic-workspace-id"]).toBe(
      "wrkspc_01TESTworkspace0001",
    );
    expect(server.requests[0]?.headers["anthropic-version"]).toBe(
      ANTHROPIC_MESSAGES_API_VERSION,
    );
  });

  it("sends anthropic-version required for structured outputs", async () => {
    const server = await startFakeAnthropicMessagesServer();
    servers.push(server);
    const adapter = new AnthropicProviderAdapter({
      apiKey: "test-key",
      baseURL: server.origin,
      maxRetries: 0,
    });

    await adapter.generateText({
      model: "claude-sonnet-5-5",
      messages: [{ role: "user", content: "hello" }],
    });

    const version = server.requests[0]?.headers["anthropic-version"];
    expect(version).toBe(ANTHROPIC_MESSAGES_API_VERSION);
  });

  it("does not double-count thinking_tokens in billed output usage", async () => {
    const server = await startFakeAnthropicMessagesServer();
    servers.push(server);
    const adapter = new AnthropicProviderAdapter({
      apiKey: "test-key",
      baseURL: server.origin,
      maxRetries: 0,
    });

    const result = await adapter.generateText({
      model: "claude-test-snapshot",
      messages: [{ role: "user", content: "usage-thinking-breakdown" }],
    });

    expect(result.usage?.outputTokens).toBe(348);
    expect(result.usage?.inputTokens).toBe(100);
    expect(result.usage?.cachedInputTokens).toBe(20);
    expect(result.usage?.totalTokens).toBe(448);
  });

  it("structured request omits unsupported sampling parameters", async () => {
    const server = await startFakeAnthropicMessagesServer();
    servers.push(server);
    const adapter = new AnthropicProviderAdapter({
      apiKey: "test-key",
      baseURL: server.origin,
      maxRetries: 0,
    });

    await adapter.generateText({
      model: "claude-sonnet-5-5",
      messages: [{ role: "user", content: "builder-m20-json-schema" }],
      jsonSchema: BuilderProposalOpenAiJsonSchema,
    });

    const body = server.requests[0]?.body as Record<string, unknown>;
    expect(body).not.toHaveProperty("temperature");
    expect(body).not.toHaveProperty("top_p");
    expect(body).not.toHaveProperty("top_k");
  });

  it("maps BuilderProposal jsonSchema to Messages output_config.format json_schema", async () => {
    const server = await startFakeAnthropicMessagesServer();
    servers.push(server);
    const adapter = new AnthropicProviderAdapter({
      apiKey: "test-key",
      baseURL: server.origin,
      maxRetries: 0,
    });

    await adapter.generateText({
      model: "claude-sonnet-5-5",
      messages: [{ role: "user", content: "builder-m20-json-schema" }],
      jsonSchema: BuilderProposalOpenAiJsonSchema,
    });

    expect(server.requests).toHaveLength(1);
    expect(server.requests[0]?.url).toBe("/v1/messages");
    const body = server.requests[0]?.body as Record<string, unknown>;
    const projected = projectJsonSchemaForAnthropicOutput(
      BuilderProposalOpenAiJsonSchema,
    );
    expect(body.output_config).toEqual({
      format: {
        type: "json_schema",
        schema: projected,
      },
    });
    expect(body.model).toBe("claude-sonnet-5-5");
    expect(JSON.stringify(body)).not.toContain("test-key");
    expect(JSON.stringify(body)).not.toContain('"pattern"');
  });

  it("normalizes refusal and max_tokens stop reasons", async () => {
    const server = await startFakeAnthropicMessagesServer();
    servers.push(server);
    const adapter = new AnthropicProviderAdapter({
      apiKey: "test-key",
      baseURL: server.origin,
      maxRetries: 0,
    });

    const refusal = await adapter.generateText({
      model: "claude-test-snapshot",
      messages: [{ role: "user", content: "refusal" }],
    });
    expect(refusal.finishReason).toBe("blocked");
    expect(refusal.providerFinishReason).toBe("refusal");

    const length = await adapter.generateText({
      model: "claude-test-snapshot",
      messages: [{ role: "user", content: "max-tokens" }],
    });
    expect(length.finishReason).toBe("length");
    expect(length.providerFinishReason).toBe("max_tokens");
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
