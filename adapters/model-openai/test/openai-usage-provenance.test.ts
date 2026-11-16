import { BuilderProposalOpenAiJsonSchema } from "@osva/domain/builder";
import type OpenAI from "openai";
import { afterEach, describe, expect, it } from "vitest";

import { OpenAIProviderAdapter } from "../src/openai-provider-adapter.js";
import {
  normalizeOpenAiChatCompletionUsage,
  normalizeOpenAiResponsesUsage,
  sanitizeProviderModelId,
} from "../src/openai-usage.js";
import { startFakeOpenAIResponsesServer } from "./fake-openai-server.js";

const servers: Array<{ close(): Promise<void> }> = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

describe("openai usage normalization", () => {
  it("treats cached input tokens as a subset of input (no double-counting)", () => {
    const usage = normalizeOpenAiResponsesUsage({
      input_tokens: 120,
      output_tokens: 15,
      total_tokens: 135,
      input_tokens_details: { cached_tokens: 8, cache_write_tokens: 0 },
      output_tokens_details: { reasoning_tokens: 0 },
    });

    expect(usage).toEqual({
      inputTokens: 120,
      outputTokens: 15,
      totalTokens: 135,
      cachedInputTokens: 8,
    });
    expect(usage!.totalTokens).toBe(usage!.inputTokens + usage!.outputTokens);
  });

  it("omits cachedInputTokens when the provider reports zero cached tokens", () => {
    const usage = normalizeOpenAiResponsesUsage({
      input_tokens: 12,
      output_tokens: 3,
      total_tokens: 15,
      input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 },
      output_tokens_details: { reasoning_tokens: 0 },
    });

    expect(usage?.cachedInputTokens).toBeUndefined();
  });

  it("distinguishes missing usage from genuine zero-token usage", () => {
    expect(normalizeOpenAiResponsesUsage(undefined)).toBeUndefined();
    expect(
      normalizeOpenAiResponsesUsage({
        input_tokens: 0,
        output_tokens: 0,
        total_tokens: 0,
        input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 },
        output_tokens_details: { reasoning_tokens: 0 },
      }),
    ).toEqual({
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
    });
  });

  it("marks chat usage incomplete when required token fields are absent", () => {
    expect(
      normalizeOpenAiChatCompletionUsage(
        {} as OpenAI.Completions.CompletionUsage,
      ),
    ).toEqual({
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      incomplete: true,
    });
  });

  it("does not fabricate provider model identity", () => {
    expect(sanitizeProviderModelId(undefined)).toBeUndefined();
    expect(sanitizeProviderModelId("  gpt-4o-real  ")).toBe("gpt-4o-real");
    expect(sanitizeProviderModelId("bad model id with spaces")).toBeUndefined();
  });
});

describe("OpenAIProviderAdapter provenance", () => {
  async function adapter(): Promise<OpenAIProviderAdapter> {
    const server = await startFakeOpenAIResponsesServer();
    servers.push(server);
    return new OpenAIProviderAdapter({
      apiKey: "test-key",
      baseURL: server.origin,
      maxRetries: 0,
    });
  }

  it("retains actual model identity from Responses API responses", async () => {
    const client = await adapter();
    const result = await client.generateText({
      model: "gpt-requested-alias",
      messages: [{ role: "user", content: "Explain this concept." }],
    });

    expect(result.invocation).toEqual({
      configuredProviderModelId: "gpt-requested-alias",
      providerReportedModelId: "gpt-5.1-2026-01-15",
    });
  });

  it("leaves provider-reported model absent when the Responses payload omits model", async () => {
    const client = await adapter();
    const result = await client.generateText({
      model: "gpt-requested-alias",
      messages: [{ role: "user", content: "responses-provenance-no-model" }],
    });

    expect(result.invocation).toEqual({
      configuredProviderModelId: "gpt-requested-alias",
    });
    expect(result.invocation).not.toHaveProperty("providerReportedModelId");
  });

  it("leaves usage undefined when the Responses payload omits usage", async () => {
    const client = await adapter();
    const result = await client.generateText({
      model: "gpt-requested-alias",
      messages: [{ role: "user", content: "responses-provenance-no-usage" }],
    });

    expect(result.usage).toBeUndefined();
    expect(result.invocation?.providerReportedModelId).toBe(
      "gpt-reported-alias",
    );
  });

  it("normalizes Chat Completions usage with cached tokens and provenance", async () => {
    const client = await adapter();
    const result = await client.generateText({
      model: "gpt-requested-chat",
      messages: [
        { role: "user", content: "chat-provenance-actual-model probe" },
      ],
      jsonSchema: BuilderProposalOpenAiJsonSchema,
    });

    expect(result.usage).toEqual({
      inputTokens: 120,
      outputTokens: 15,
      totalTokens: 135,
      cachedInputTokens: 8,
    });
    expect(result.invocation).toEqual({
      configuredProviderModelId: "gpt-requested-chat",
      providerReportedModelId: "gpt-4o-mini-actual-snapshot-2026",
    });
    expect(result.invocation?.configuredProviderModelId).not.toBe(
      result.invocation?.providerReportedModelId,
    );
  });

  it("handles chat completions without cached token details", async () => {
    const client = await adapter();
    const result = await client.generateText({
      model: "gpt-requested-chat",
      messages: [{ role: "user", content: "chat-provenance-no-cached probe" }],
      jsonSchema: BuilderProposalOpenAiJsonSchema,
    });

    expect(result.usage).toEqual({
      inputTokens: 40,
      outputTokens: 12,
      totalTokens: 52,
    });
    expect(result.usage?.cachedInputTokens).toBeUndefined();
  });

  it("does not guess provider model identity on chat completions", async () => {
    const client = await adapter();
    const result = await client.generateText({
      model: "gpt-requested-chat",
      messages: [{ role: "user", content: "chat-provenance-no-model probe" }],
      jsonSchema: BuilderProposalOpenAiJsonSchema,
    });

    expect(result.invocation).toEqual({
      configuredProviderModelId: "gpt-requested-chat",
    });
  });

  it("preserves structured-output compatibility on the chat path", async () => {
    const client = await adapter();
    const result = await client.generateText({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: "builder-m20-json-schema" }],
      jsonSchema: BuilderProposalOpenAiJsonSchema,
    });

    expect(result.text).toContain("schemaVersion");
    expect(result.providerRequestId).toBe("chat_m20_schema_probe");
  });
});
