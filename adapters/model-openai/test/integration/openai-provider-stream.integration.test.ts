import { assembleModelStreamCompletion } from "@osva-ai/contracts";
import {
  assembleStream,
  collectModelStreamEvents,
} from "../../../../packages/model-gateway/test/model-stream-test-helpers.js";
import { describe, expect, it } from "vitest";

import { OpenAIProviderAdapter } from "../../src/openai-provider-adapter.js";
import { startFakeOpenAIResponsesServer } from "../fake-openai-server.js";

describe("OpenAIProviderAdapter streaming", () => {
  it("streams responses API text and assembles like sync", async () => {
    const server = await startFakeOpenAIResponsesServer();
    try {
      const adapter = new OpenAIProviderAdapter({
        apiKey: "test-key",
        baseURL: server.origin,
        maxRetries: 0,
      });

      const sync = await adapter.generateText({
        model: "gpt-test",
        messages: [{ role: "user", content: "Hello" }],
      });

      const events = await collectModelStreamEvents(
        adapter.generateCompletionStream({
          model: "gpt-test",
          messages: [{ role: "user", content: "Hello" }],
        }),
      );

      expect(events[0]?.sequence).toBe(0);
      expect(events.at(-1)?.kind).toBe("COMPLETED");

      const assembled = assembleModelStreamCompletion(events);
      expect(assembled.ok).toBe(true);
      if (assembled.ok) {
        expect(assembled.result.text).toBe(sync.text);
        expect(assembled.result.finishReason).toBe("stop");
      }
    } finally {
      await server.close();
    }
  });

  it("streams chat completions for tool/json paths", async () => {
    const server = await startFakeOpenAIResponsesServer();
    try {
      const adapter = new OpenAIProviderAdapter({
        apiKey: "test-key",
        baseURL: server.origin,
        maxRetries: 0,
      });

      const outcome = await assembleStream(
        adapter.generateCompletionStream({
          model: "gpt-test",
          messages: [{ role: "user", content: "declarative-ok" }],
          toolDefinitions: [
            {
              name: "echo",
              inputSchema: {
                type: "object",
                properties: { value: { type: "string" } },
              },
            },
          ],
        }),
      );
      expect(outcome.ok).toBe(true);
    } finally {
      await server.close();
    }
  });
});
