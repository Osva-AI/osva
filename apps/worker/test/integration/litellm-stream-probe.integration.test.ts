/**
 * Manual diagnostic: OpenAIProviderAdapter stream through live LiteLLM.
 * OSVA_LITELLM_LIVE_ACCEPTANCE=1
 */
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { assembleModelStreamCompletion } from "@osva-ai/contracts";
import { collectModelStreamEvents } from "../../../../packages/model-gateway/test/model-stream-test-helpers.js";
import { OpenAIProviderAdapter } from "../../../../adapters/model-openai/src/openai-provider-adapter.js";

const require = createRequire(
  path.join(
    fileURLToPath(import.meta.url),
    "../../../../adapters/model-openai/package.json",
  ),
);
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
const OpenAI = require("openai").default as typeof import("openai").default;
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  litellmConnectionEndpoint,
  startLitellmLiveStack,
  type LitellmLiveStack,
} from "./litellm-live-proxy-harness.js";

const LIVE = process.env.OSVA_LITELLM_LIVE_ACCEPTANCE === "1";

describe.skipIf(!LIVE)("LiteLLM adapter stream probe", () => {
  let litellm: LitellmLiveStack;

  beforeAll(async () => {
    litellm = await startLitellmLiveStack();
  }, 240_000);

  afterAll(async () => {
    await litellm?.teardown();
  });

  it("streams through LiteLLM with Responses API events", async () => {
    const before = litellm.fakeOpenAI.requests.length;
    const rawClient = new OpenAI({
      apiKey: litellm.masterKey,
      baseURL: litellmConnectionEndpoint(litellm.proxyBaseUrl),
      maxRetries: 0,
    });
    const rawTypes: string[] = [];
    try {
      const rawStream = await rawClient.responses.create({
        model: "gpt-test-snapshot",
        stream: true,
        store: false,
        instructions: "You are concise.",
        input: [
          { type: "message", role: "user", content: "stream-success-check" },
        ],
        max_output_tokens: 500,
      });
      for await (const event of rawStream) {
        rawTypes.push(event.type);
      }
    } catch (error) {
      console.log(
        JSON.stringify({
          probe: "raw-sdk-stream-error",
          message: error instanceof Error ? error.message : String(error),
          rawTypes,
        }),
      );
      throw error;
    }
    console.log(JSON.stringify({ probe: "raw-sdk-stream-types", rawTypes }));

    const adapter = new OpenAIProviderAdapter({
      apiKey: litellm.masterKey,
      baseURL: litellmConnectionEndpoint(litellm.proxyBaseUrl),
      maxRetries: 0,
    });
    const events = await collectModelStreamEvents(
      adapter.generateCompletionStream({
        model: "gpt-test-snapshot",
        messages: [
          { role: "system", content: "You are concise." },
          { role: "user", content: "stream-success-check" },
        ],
        maxOutputTokens: 500,
      }),
    );
    const assembled = assembleModelStreamCompletion(events);
    console.log(
      JSON.stringify({
        probe: "adapter-stream-events",
        assembled,
        eventKinds: events.map((event) => event.kind),
        fakeRequests: litellm.fakeOpenAI.requests.slice(before).map((r) => ({
          url: r.url,
          stream: (r.body as { stream?: boolean })?.stream,
        })),
      }),
    );
    expect(assembled.ok).toBe(true);
    if (!assembled.ok) {
      throw new Error(assembled.error.message);
    }
    expect(assembled.result.text.length).toBeGreaterThan(0);
    expect(events.at(-1)?.kind).toBe("COMPLETED");
    expect(litellm.fakeOpenAI.requests.length).toBeGreaterThan(before);
    const eventTypes = events.map((event) => event.kind);
    expect(eventTypes).toContain("TEXT_DELTA");
    console.log(
      JSON.stringify({
        probe: "adapter-stream",
        eventKinds: eventTypes,
        textLength: assembled.result.text.length,
      }),
    );
  });
});
