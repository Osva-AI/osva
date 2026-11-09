import { MODEL_ERROR_CODES } from "@osva-ai/contracts";
import { BuilderProposalOpenAiJsonSchema } from "@osva/domain/builder";
import { afterEach, describe, expect, it } from "vitest";

import { OpenAIProviderAdapter } from "../src/openai-provider-adapter.js";
import { startFakeOpenAIResponsesServer } from "./fake-openai-server.js";

const servers: Array<{ close(): Promise<void> }> = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

describe("OpenAIProviderAdapter", () => {
  it("calls the Responses API with mapped messages, model ID, and store:false", async () => {
    const server = await startFakeOpenAIResponsesServer();
    servers.push(server);
    const adapter = new OpenAIProviderAdapter({
      apiKey: "test-key",
      baseURL: server.origin,
      maxRetries: 0,
    });

    const result = await adapter.generateText({
      model: "gpt-test-snapshot",
      messages: [
        { role: "system", content: "You are concise." },
        { role: "user", content: "Explain this concept." },
        { role: "assistant", content: "It is an operating layer." },
      ],
      maxOutputTokens: 64,
    });

    expect(result).toEqual({
      text: "normalized text from fake openai",
      finishReason: "stop",
      usage: {
        inputTokens: 120,
        outputTokens: 15,
        totalTokens: 135,
        cachedInputTokens: 8,
      },
    });
    expect(server.requests).toHaveLength(1);
    expect(server.requests[0]?.url).toBe("/v1/responses");
    expect(server.requests[0]?.body).toMatchObject({
      model: "gpt-test-snapshot",
      instructions: "You are concise.",
      store: false,
      max_output_tokens: 64,
      input: [
        {
          type: "message",
          role: "user",
          content: "Explain this concept.",
        },
        {
          type: "message",
          role: "assistant",
          content: "It is an operating layer.",
        },
      ],
    });
    expect(JSON.stringify(result)).not.toContain("resp_ok");
    expect(result).not.toHaveProperty("output");
    expect(result.usage).toEqual({
      inputTokens: 120,
      outputTokens: 15,
      totalTokens: 135,
      cachedInputTokens: 8,
    });
  });

  it("normalizes authentication, rate-limit, and invalid output errors", async () => {
    const server = await startFakeOpenAIResponsesServer();
    servers.push(server);
    const adapter = new OpenAIProviderAdapter({
      apiKey: "test-key",
      baseURL: server.origin,
      maxRetries: 0,
    });

    await expect(
      adapter.generateText({
        model: "gpt-test-snapshot",
        messages: [{ role: "user", content: "auth-fail" }],
      }),
    ).rejects.toMatchObject({
      code: MODEL_ERROR_CODES.MODEL_AUTHENTICATION_ERROR,
    });

    await expect(
      adapter.generateText({
        model: "gpt-test-snapshot",
        messages: [{ role: "user", content: "rate-limit" }],
      }),
    ).rejects.toMatchObject({
      code: MODEL_ERROR_CODES.MODEL_RATE_LIMITED,
    });

    await expect(
      adapter.generateText({
        model: "gpt-test-snapshot",
        messages: [{ role: "user", content: "empty" }],
      }),
    ).rejects.toMatchObject({
      code: MODEL_ERROR_CODES.INVALID_MODEL_RESPONSE,
    });
  });

  it("normalizes a provider network error", async () => {
    const adapter = new OpenAIProviderAdapter({
      apiKey: "test-key",
      baseURL: "http://127.0.0.1:1/v1",
      maxRetries: 0,
      timeout: 250,
    });

    await expect(
      adapter.generateText({
        model: "gpt-test-snapshot",
        messages: [{ role: "user", content: "hello" }],
      }),
    ).rejects.toMatchObject({
      code: MODEL_ERROR_CODES.MODEL_PROVIDER_ERROR,
    });
  });

  it("normalizes a provider timeout after abort", async () => {
    const server = await startFakeOpenAIResponsesServer();
    servers.push(server);
    const adapter = new OpenAIProviderAdapter({
      apiKey: "test-key",
      baseURL: server.origin,
      maxRetries: 0,
      timeout: 20,
    });
    const controller = new AbortController();

    const pending = adapter.generateText({
      model: "gpt-test-snapshot",
      messages: [{ role: "user", content: "hang" }],
      signal: controller.signal,
    });
    controller.abort();

    await expect(pending).rejects.toMatchObject({
      code: MODEL_ERROR_CODES.MODEL_CANCELLED,
      retryable: false,
    });
  });

  it("passes internal AbortSignal to OpenAI RequestOptions.signal", async () => {
    const controller = new AbortController();
    let seen: AbortSignal | undefined;
    let releaseFetch: (() => void) | undefined;
    const fetchStarted = new Promise<void>((resolve) => {
      releaseFetch = resolve;
    });
    const adapter = new OpenAIProviderAdapter({
      apiKey: "test-key",
      baseURL: "http://127.0.0.1:9",
      maxRetries: 0,
      fetch: async (_input, init) => {
        seen = init?.signal ?? undefined;
        releaseFetch?.();
        return new Promise<Response>((_, reject) => {
          init?.signal?.addEventListener("abort", () => {
            const error = new Error("The operation was aborted.");
            error.name = "AbortError";
            reject(error);
          });
        });
      },
    });

    const pending = adapter.generateText({
      model: "gpt-test-snapshot",
      messages: [{ role: "user", content: "hello" }],
      signal: controller.signal,
    });

    await fetchStarted;
    expect(seen).toBeDefined();
    expect(seen?.aborted).toBe(false);
    controller.abort();
    expect(seen?.aborted).toBe(true);

    await expect(pending).rejects.toMatchObject({
      code: MODEL_ERROR_CODES.MODEL_CANCELLED,
      retryable: false,
    });
  });

  it("maps chat completion provider HTTP errors with status and sanitized metadata", async () => {
    const server = await startFakeOpenAIResponsesServer();
    servers.push(server);
    const adapter = new OpenAIProviderAdapter({
      apiKey: "test-key",
      baseURL: server.origin,
      maxRetries: 0,
    });

    const request = {
      model: "gpt-4o-mini",
      messages: [{ role: "user" as const, content: "openai-error-400" }],
      jsonSchema: BuilderProposalOpenAiJsonSchema,
    };

    await expect(adapter.generateText(request)).rejects.toMatchObject({
      code: MODEL_ERROR_CODES.MODEL_INVALID_REQUEST,
      providerStatusCode: 400,
      provider: "openai",
      providerErrorType: "invalid_request_error",
      providerErrorCode: "invalid_json_schema",
      providerErrorParam: "response_format",
      providerRequestId: "req_fake_openai_error",
      retryable: false,
    });

    await expect(
      adapter.generateText({
        ...request,
        messages: [
          { role: "user", content: "openai-error-400-unsupported-parameter" },
        ],
      }),
    ).rejects.toMatchObject({
      code: MODEL_ERROR_CODES.MODEL_INVALID_REQUEST,
      providerStatusCode: 400,
      providerErrorCode: "unsupported_parameter",
      providerErrorParam: "max_tokens",
    });

    await expect(
      adapter.generateText({
        ...request,
        messages: [{ role: "user", content: "openai-error-401" }],
      }),
    ).rejects.toMatchObject({
      code: MODEL_ERROR_CODES.MODEL_AUTHENTICATION_ERROR,
      providerStatusCode: 401,
    });

    await expect(
      adapter.generateText({
        ...request,
        messages: [{ role: "user", content: "openai-error-403" }],
      }),
    ).rejects.toMatchObject({
      code: MODEL_ERROR_CODES.MODEL_AUTHENTICATION_ERROR,
      providerStatusCode: 403,
    });

    await expect(
      adapter.generateText({
        ...request,
        messages: [{ role: "user", content: "openai-error-429" }],
      }),
    ).rejects.toMatchObject({
      code: MODEL_ERROR_CODES.MODEL_RATE_LIMITED,
      providerStatusCode: 429,
      retryable: true,
      retryAfterMs: 2000,
    });

    await expect(
      adapter.generateText({
        ...request,
        messages: [{ role: "user", content: "openai-error-500" }],
      }),
    ).rejects.toMatchObject({
      code: MODEL_ERROR_CODES.MODEL_PROVIDER_ERROR,
      providerStatusCode: 500,
      retryable: true,
    });

    expect(
      server.requests.filter((r) => r.url.includes("/chat/completions")),
    ).toHaveLength(6);
  });

  it("does not perform hidden SDK retries when maxRetries is 0", async () => {
    const server = await startFakeOpenAIResponsesServer();
    servers.push(server);
    const adapter = new OpenAIProviderAdapter({
      apiKey: "test-key",
      baseURL: server.origin,
      maxRetries: 0,
    });

    await expect(
      adapter.generateText({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: "openai-error-500" }],
        jsonSchema: BuilderProposalOpenAiJsonSchema,
      }),
    ).rejects.toMatchObject({
      code: MODEL_ERROR_CODES.MODEL_PROVIDER_ERROR,
    });

    const chatCalls = server.requests.filter((r) =>
      r.url.includes("/chat/completions"),
    );
    expect(chatCalls).toHaveLength(1);
  });

  it("maps M20.2 BuilderProposal jsonSchema to Chat Completions response_format with strict json_schema", async () => {
    const server = await startFakeOpenAIResponsesServer();
    servers.push(server);
    const adapter = new OpenAIProviderAdapter({
      apiKey: "test-key",
      baseURL: server.origin,
      maxRetries: 0,
    });

    const result = await adapter.generateText({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: "builder-m20-json-schema" }],
      jsonSchema: BuilderProposalOpenAiJsonSchema,
    });

    expect(result.providerRequestId).toBe("chat_m20_schema_probe");

    const chatReq = server.requests.find((r) =>
      r.url.includes("/chat/completions"),
    );
    expect(chatReq).toBeDefined();
    const body = chatReq?.body as Record<string, unknown>;
    expect(body.response_format).toEqual({
      type: "json_schema",
      json_schema: {
        name: "agent_output",
        schema: BuilderProposalOpenAiJsonSchema,
        strict: true,
      },
    });
  });
});
