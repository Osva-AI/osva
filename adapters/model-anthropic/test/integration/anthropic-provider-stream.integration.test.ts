import { assembleModelStreamCompletion } from "@osva-ai/contracts";
import { collectModelStreamEvents } from "../../../../packages/model-gateway/test/model-stream-test-helpers.js";
import { describe, expect, it } from "vitest";

import { AnthropicProviderAdapter } from "../../src/anthropic-provider-adapter.js";
import { startFakeAnthropicMessagesServer } from "../fake-anthropic-server.js";

describe("AnthropicProviderAdapter streaming", () => {
  it("streams messages and matches sync text", async () => {
    const server = await startFakeAnthropicMessagesServer();
    try {
      const adapter = new AnthropicProviderAdapter({
        apiKey: "test-key",
        baseURL: server.origin,
      });
      const sync = await adapter.generateText({
        model: "claude-test",
        messages: [{ role: "user", content: "Hello" }],
      });

      const events = await collectModelStreamEvents(
        adapter.generateCompletionStream({
          model: "claude-test",
          messages: [{ role: "user", content: "Hello" }],
        }),
      );

      const assembled = assembleModelStreamCompletion(events);
      expect(assembled.ok).toBe(true);
      if (assembled.ok) {
        expect(assembled.result.text).toBe(sync.text);
        expect(assembled.result.usage).toEqual({
          inputUnits: 120,
          outputUnits: 15,
          cachedUnits: 8,
        });
      }
    } finally {
      await server.close();
    }
  });
});
