import { MODEL_ERROR_CODES } from "@osva-ai/contracts";
import { BuilderProposalOpenAiJsonSchema } from "@osva/domain/builder";
import { afterEach, describe, expect, it, vi } from "vitest";

import { GeminiProviderAdapter } from "../src/gemini-provider-adapter.js";
import { projectJsonSchemaForGeminiResponseJsonSchema } from "../src/gemini-response-json-schema-projection.js";
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
    expect(result.usage?.outputTokens).toBe(20 + 30);
    expect(result.usage?.totalTokens).toBe(
      (result.usage?.inputTokens ?? 0) + 50,
    );
  });

  it("maps M20.2 BuilderProposal jsonSchema to generationConfig responseJsonSchema + JSON mime type", async () => {
    const server = await startFakeGeminiGenerateContentServer();
    servers.push(server);
    const adapter = new GeminiProviderAdapter({
      apiKey: "test-key",
      baseURL: server.origin,
    });

    await adapter.generateText({
      model: "gemini-test-snapshot",
      messages: [{ role: "user", content: "builder-m20-json-schema" }],
      jsonSchema: BuilderProposalOpenAiJsonSchema,
    });

    expect(server.requests).toHaveLength(1);
    const generationConfig = (
      server.requests[0]?.body as { generationConfig?: Record<string, unknown> }
    )?.generationConfig;
    const projected = projectJsonSchemaForGeminiResponseJsonSchema(
      BuilderProposalOpenAiJsonSchema,
    );
    expect(generationConfig).toMatchObject({
      responseMimeType: "application/json",
      responseJsonSchema: projected,
    });
    expect(generationConfig).not.toHaveProperty("responseSchema");
    expect(JSON.stringify(generationConfig?.responseJsonSchema)).not.toContain(
      '"const"',
    );
    expect(JSON.stringify(generationConfig?.responseJsonSchema)).not.toContain(
      '"pattern"',
    );
    expect(JSON.stringify(BuilderProposalOpenAiJsonSchema)).toContain(
      '"const"',
    );
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
      providerTransportErrorCategory: "connection_failed",
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

  describe("M20.7.3 transport forensics (mocked fetch)", () => {
    const baseRequest = {
      model: "gemini-test-snapshot",
      messages: [{ role: "user" as const, content: "hello" }],
    };

    function adapterWithFetch(fetchImpl: typeof fetch): GeminiProviderAdapter {
      return new GeminiProviderAdapter({
        apiKey: "test-key",
        baseURL: "https://generativelanguage.googleapis.com/v1beta",
        fetch: fetchImpl,
      });
    }

    function jsonResponse(status: number, body: string): Response {
      return new Response(body, {
        status,
        headers: { "content-type": "application/json" },
      });
    }

    it("A: request construction failure maps transport category", async () => {
      const projection =
        await import("../src/gemini-response-json-schema-projection.js");
      const spy = vi
        .spyOn(projection, "projectJsonSchemaForGeminiResponseJsonSchema")
        .mockImplementation(() => {
          throw new Error("projection failed");
        });
      const fetchImpl = vi.fn() as typeof fetch;
      try {
        const adapter = adapterWithFetch(fetchImpl);
        const error = await adapter
          .generateText({
            ...baseRequest,
            jsonSchema: BuilderProposalOpenAiJsonSchema,
          })
          .catch((e: unknown) => e);
        expect(error).toMatchObject({
          code: MODEL_ERROR_CODES.MODEL_PROVIDER_ERROR,
          provider: "google-gemini",
          providerTransportErrorCategory: "request_construction",
        });
        expect(fetchImpl).not.toHaveBeenCalled();
      } finally {
        spy.mockRestore();
      }
    });

    it("B: fetch throws before HTTP response", async () => {
      const fetchImpl = vi
        .fn()
        .mockRejectedValue(new TypeError("fetch failed"));
      const adapter = adapterWithFetch(fetchImpl as typeof fetch);
      const error = await adapter
        .generateText(baseRequest)
        .catch((e: unknown) => e);
      expect(error).toMatchObject({
        code: MODEL_ERROR_CODES.MODEL_PROVIDER_ERROR,
        providerTransportErrorCategory: "connection_failed",
      });
    });

    it.each([
      [
        "C",
        400,
        '{"error":{"message":"schema","status":"INVALID_ARGUMENT"}}',
        MODEL_ERROR_CODES.MODEL_INVALID_REQUEST,
        { providerStatusCode: 400, providerErrorType: "INVALID_ARGUMENT" },
      ],
      [
        "D",
        401,
        '{"error":{"message":"auth","status":"UNAUTHENTICATED"}}',
        MODEL_ERROR_CODES.MODEL_AUTHENTICATION_ERROR,
        { providerStatusCode: 401, providerErrorType: "UNAUTHENTICATED" },
      ],
      [
        "E",
        403,
        '{"error":{"message":"perm","status":"PERMISSION_DENIED"}}',
        MODEL_ERROR_CODES.MODEL_AUTHENTICATION_ERROR,
        { providerStatusCode: 403 },
      ],
      [
        "F",
        404,
        '{"error":{"message":"missing","status":"NOT_FOUND"}}',
        MODEL_ERROR_CODES.MODEL_NOT_FOUND,
        { providerStatusCode: 404 },
      ],
      [
        "G",
        429,
        '{"error":{"message":"slow","status":"RESOURCE_EXHAUSTED"}}',
        MODEL_ERROR_CODES.MODEL_RATE_LIMITED,
        { providerStatusCode: 429 },
      ],
      [
        "H",
        500,
        '{"error":{"message":"boom","status":"INTERNAL"}}',
        MODEL_ERROR_CODES.MODEL_PROVIDER_ERROR,
        { providerStatusCode: 500 },
      ],
    ])(
      "%s: Google HTTP %i preserves status through builder diagnostics",
      async (_label, status, body, code, diag) => {
        const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(status, body));
        const adapter = adapterWithFetch(fetchImpl as typeof fetch);
        const error = await adapter
          .generateText(baseRequest)
          .catch((e: unknown) => e);
        expect(error).toMatchObject({
          code,
          provider: "google-gemini",
          providerStatusCode: status,
        });
        expect(error).toMatchObject(diag);
      },
    );

    it("I: HTTP 200 with malformed JSON body", async () => {
      const fetchImpl = vi
        .fn()
        .mockResolvedValue(jsonResponse(200, "not-json{{{"));
      const adapter = adapterWithFetch(fetchImpl as typeof fetch);
      const error = await adapter
        .generateText(baseRequest)
        .catch((e: unknown) => e);
      expect(error).toMatchObject({
        code: MODEL_ERROR_CODES.INVALID_MODEL_RESPONSE,
        providerStatusCode: 200,
        providerTransportErrorCategory: "response_body_parse_failed",
      });
    });

    it("HTTP 400 with non-JSON body still preserves HTTP status", async () => {
      const fetchImpl = vi
        .fn()
        .mockResolvedValue(jsonResponse(400, "<html>bad</html>"));
      const adapter = adapterWithFetch(fetchImpl as typeof fetch);
      const error = await adapter
        .generateText(baseRequest)
        .catch((e: unknown) => e);
      expect(error).toMatchObject({
        code: MODEL_ERROR_CODES.MODEL_INVALID_REQUEST,
        providerStatusCode: 400,
      });
    });

    it("J: valid Gemini response succeeds", async () => {
      const fetchImpl = vi.fn().mockResolvedValue(
        jsonResponse(
          200,
          JSON.stringify({
            responseId: "gemini_ok",
            candidates: [
              {
                content: { parts: [{ text: "ok" }] },
                finishReason: "STOP",
              },
            ],
            usageMetadata: {
              promptTokenCount: 1,
              candidatesTokenCount: 2,
              totalTokenCount: 3,
            },
          }),
        ),
      );
      const adapter = adapterWithFetch(fetchImpl as typeof fetch);
      const result = await adapter.generateText(baseRequest);
      expect(result.text).toBe("ok");
      expect(result.usage).toEqual({
        inputTokens: 1,
        outputTokens: 2,
        totalTokens: 3,
      });
    });
  });
});
