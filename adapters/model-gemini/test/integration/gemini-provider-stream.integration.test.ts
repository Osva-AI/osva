import { assembleModelStreamCompletion } from "@osva-ai/contracts";
import { collectModelStreamEvents } from "../../../../packages/model-gateway/test/model-stream-test-helpers.js";
import { describe, expect, it } from "vitest";

import { GeminiProviderAdapter } from "../../src/gemini-provider-adapter.js";
import { startFakeGeminiGenerateContentServer } from "../fake-gemini-server.js";

describe("GeminiProviderAdapter streaming", () => {
  it("streams streamGenerateContent and matches sync output", async () => {
    const server = await startFakeGeminiGenerateContentServer();
    try {
      const adapter = new GeminiProviderAdapter({
        apiKey: "test-key",
        baseURL: server.origin,
      });
      const sync = await adapter.generateText({
        model: "gemini-2.0-flash",
        messages: [{ role: "user", content: "Hello" }],
      });

      const events = await collectModelStreamEvents(
        adapter.generateCompletionStream({
          model: "gemini-2.0-flash",
          messages: [{ role: "user", content: "Hello" }],
        }),
      );

      const assembled = assembleModelStreamCompletion(events);
      expect(assembled.ok).toBe(true);
      if (assembled.ok) {
        expect(assembled.result.text).toBe(sync.text);
      }
    } finally {
      await server.close();
    }
  });
});
