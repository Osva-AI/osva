import { MODEL_ERROR_CODES } from "@osva/contracts";
import { afterEach, describe, expect, it } from "vitest";

import { GeminiProviderAdapter } from "../src/gemini-provider-adapter.js";
import { startFakeGeminiGenerateContentServer } from "./fake-gemini-server.js";

const servers: Array<{ close(): Promise<void> }> = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

describe("GeminiProviderAdapter", () => {
  it("calls generateContent with mapped system instruction and roles", async () => {
    const server = await startFakeGeminiGenerateContentServer();
    servers.push(server);
    const adapter = new GeminiProviderAdapter({
      apiKey: "test-key",
      baseURL: server.origin,
    });

    const result = await adapter.generateText({
      model: "gemini-test-snapshot",
      messages: [
        { role: "system", content: "You are concise." },
        { role: "user", content: "Explain this concept." },
        { role: "assistant", content: "It is an operating layer." },
      ],
      maxOutputTokens: 64,
    });

    expect(result).toEqual({
      text: "normalized text from fake gemini",
      usage: {
        inputTokens: 120,
        outputTokens: 15,
        totalTokens: 135,
      },
      finishReason: "stop",
      providerFinishReason: "STOP",
      providerRequestId: "gemini_ok",
    });
    expect(server.requests).toHaveLength(1);
    expect(server.requests[0]?.url).toContain(
      "/models/gemini-test-snapshot:generateContent",
    );
    expect(server.requests[0]?.body).toMatchObject({
      systemInstruction: { parts: [{ text: "You are concise." }] },
      generationConfig: { maxOutputTokens: 64 },
      contents: [
        { role: "user", parts: [{ text: "Explain this concept." }] },
        { role: "model", parts: [{ text: "It is an operating layer." }] },
      ],
    });
    expect(JSON.stringify(result)).not.toContain("test-key");
  });

  it("includes Gemini thinking tokens in billable output usage", async () => {
    const server = await startFakeGeminiGenerateContentServer();
    servers.push(server);
    const adapter = new GeminiProviderAdapter({
      apiKey: "test-key",
      baseURL: server.origin,
    });

    const result = await adapter.generateText({
      model: "gemini-test-snapshot",
      messages: [{ role: "user", content: "thinking-usage" }],
    });

    expect(result.usage).toEqual({
      inputTokens: 100,
      outputTokens: 50,
      totalTokens: 150,
    });
  });

  it("normalizes authentication, rate-limit, quota, not-found, and invalid output errors", async () => {
    const server = await startFakeGeminiGenerateContentServer();
    servers.push(server);
    const adapter = new GeminiProviderAdapter({
      apiKey: "test-key",
      baseURL: server.origin,
    });

    await expect(
      adapter.generateText({
        model: "gemini-test-snapshot",
        messages: [{ role: "user", content: "auth-fail" }],
      }),
    ).rejects.toMatchObject({
      code: MODEL_ERROR_CODES.MODEL_AUTHENTICATION_ERROR,
      retryable: false,
    });

    await expect(
      adapter.generateText({
        model: "gemini-test-snapshot",
        messages: [{ role: "user", content: "rate-limit" }],
      }),
    ).rejects.toMatchObject({
      code: MODEL_ERROR_CODES.MODEL_RATE_LIMITED,
      retryable: true,
    });

    await expect(
      adapter.generateText({
        model: "gemini-test-snapshot",
        messages: [{ role: "user", content: "quota-exhausted" }],
      }),
    ).rejects.toMatchObject({
      code: MODEL_ERROR_CODES.MODEL_QUOTA_EXHAUSTED,
      retryable: false,
    });

    await expect(
      adapter.generateText({
        model: "gemini-test-snapshot",
        messages: [{ role: "user", content: "not-found" }],
      }),
    ).rejects.toMatchObject({
      code: MODEL_ERROR_CODES.MODEL_NOT_FOUND,
      retryable: false,
    });

    await expect(
      adapter.generateText({
        model: "gemini-test-snapshot",
        messages: [{ role: "user", content: "empty" }],
      }),
    ).rejects.toMatchObject({
      code: MODEL_ERROR_CODES.INVALID_MODEL_RESPONSE,
    });
  });

  it("normalizes provider network errors, timeout, and cancellation", async () => {
    const server = await startFakeGeminiGenerateContentServer();
    servers.push(server);
    const adapter = new GeminiProviderAdapter({
      apiKey: "test-key",
      baseURL: "http://127.0.0.1:1/v1beta",
      timeout: 250,
    });

    await expect(
      adapter.generateText({
        model: "gemini-test-snapshot",
        messages: [{ role: "user", content: "hello" }],
      }),
    ).rejects.toMatchObject({
      code: MODEL_ERROR_CODES.MODEL_PROVIDER_ERROR,
      retryable: true,
    });

    const hangingAdapter = new GeminiProviderAdapter({
      apiKey: "test-key",
      baseURL: server.origin,
      timeout: 20,
    });
    await expect(
      hangingAdapter.generateText({
        model: "gemini-test-snapshot",
        messages: [{ role: "user", content: "hang" }],
      }),
    ).rejects.toMatchObject({
      code: MODEL_ERROR_CODES.MODEL_REQUEST_TIMEOUT,
      retryable: true,
    });

    const controller = new AbortController();
    const pending = hangingAdapter.generateText({
      model: "gemini-test-snapshot",
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
    const server = await startFakeGeminiGenerateContentServer();
    servers.push(server);
    const adapter = new GeminiProviderAdapter({
      apiKey: "test-key",
      baseURL: server.origin,
    });

    await expect(
      adapter.generateText({
        model: "gemini-test-snapshot",
        messages: [{ role: "user", content: "malformed" }],
      }),
    ).rejects.toMatchObject({
      code: MODEL_ERROR_CODES.INVALID_MODEL_RESPONSE,
    });
  });
});
