import { BuilderProposalOpenAiJsonSchema } from "@osva/domain/builder";
import { afterEach, describe, expect, it } from "vitest";

import { GeminiProviderAdapter } from "../src/gemini-provider-adapter.js";
import { normalizeGeminiGenerateContentUsage } from "../src/gemini-usage.js";
import { startFakeGeminiGenerateContentServer } from "./fake-gemini-server.js";

const servers: Array<{ close(): Promise<void> }> = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

describe("gemini usage normalization", () => {
  it("does not add cachedContentTokenCount to promptTokenCount", () => {
    const usage = normalizeGeminiGenerateContentUsage({
      promptTokenCount: 100,
      cachedContentTokenCount: 40,
      candidatesTokenCount: 12,
      totalTokenCount: 112,
    });

    expect(usage).toEqual({
      inputTokens: 100,
      outputTokens: 12,
      totalTokens: 112,
      cachedInputTokens: 40,
    });
    expect(usage!.inputTokens).not.toBe(140);
  });

  it("includes thinking tokens in output, not input", () => {
    expect(
      normalizeGeminiGenerateContentUsage({
        promptTokenCount: 100,
        candidatesTokenCount: 20,
        thoughtsTokenCount: 30,
        totalTokenCount: 150,
      }),
    ).toEqual({
      inputTokens: 100,
      outputTokens: 50,
      totalTokens: 150,
    });
  });

  it("preserves provider total when it exceeds input plus output", () => {
    expect(
      normalizeGeminiGenerateContentUsage({
        promptTokenCount: 50,
        candidatesTokenCount: 10,
        thoughtsTokenCount: 5,
        totalTokenCount: 80,
      }),
    ).toEqual({
      inputTokens: 50,
      outputTokens: 15,
      totalTokens: 80,
    });
  });

  it("marks inconsistent totals incomplete", () => {
    expect(
      normalizeGeminiGenerateContentUsage({
        promptTokenCount: 10,
        candidatesTokenCount: 5,
        totalTokenCount: 5,
      }),
    ).toMatchObject({ incomplete: true, totalTokens: 5 });
  });

  it("returns undefined for absent usage metadata", () => {
    expect(normalizeGeminiGenerateContentUsage(undefined)).toBeUndefined();
  });
});

describe("GeminiProviderAdapter provenance", () => {
  async function adapter(): Promise<GeminiProviderAdapter> {
    const server = await startFakeGeminiGenerateContentServer();
    servers.push(server);
    return new GeminiProviderAdapter({
      apiKey: "test-key",
      baseURL: server.origin,
    });
  }

  it("retains modelVersion and responseId", async () => {
    const client = await adapter();
    const result = await client.generateText({
      model: "gemini-requested",
      messages: [{ role: "user", content: "Explain this concept." }],
    });

    expect(result.providerRequestId).toBe("gemini_ok");
    expect(result.invocation).toEqual({
      configuredProviderModelId: "gemini-requested",
      providerReportedModelId: "gemini-2.0-flash-001",
    });
    expect(JSON.stringify(result)).not.toContain("test-key");
  });

  it("omits reported model when modelVersion is absent", async () => {
    const client = await adapter();
    const result = await client.generateText({
      model: "gemini-requested",
      messages: [{ role: "user", content: "provenance-no-model" }],
    });

    expect(result.invocation).toEqual({
      configuredProviderModelId: "gemini-requested",
    });
  });

  it("omits usage when metadata is absent", async () => {
    const client = await adapter();
    const result = await client.generateText({
      model: "gemini-requested",
      messages: [{ role: "user", content: "provenance-no-usage" }],
    });

    expect(result.usage).toBeUndefined();
  });

  it("reports tool-use prompt tokens without inflating input", async () => {
    const client = await adapter();
    const result = await client.generateText({
      model: "gemini-requested",
      messages: [
        { role: "user", content: "provenance-tool-use-prompt-tokens" },
      ],
    });

    expect(result.usage).toEqual({
      inputTokens: 90,
      outputTokens: 10,
      totalTokens: 100,
    });
  });

  it("handles partial usage metadata", async () => {
    const client = await adapter();
    const result = await client.generateText({
      model: "gemini-requested",
      messages: [{ role: "user", content: "provenance-partial-usage" }],
    });

    expect(result.usage).toMatchObject({
      inputTokens: 25,
      incomplete: true,
    });
  });

  it("preserves structured-output compatibility", async () => {
    const client = await adapter();
    const result = await client.generateText({
      model: "gemini-test-snapshot",
      messages: [{ role: "user", content: "builder-m20-json-schema" }],
      jsonSchema: BuilderProposalOpenAiJsonSchema,
    });

    expect(result.text).toContain("schemaVersion");
    expect(result.providerRequestId).toBe("gemini_m20_schema_probe");
  });
});
