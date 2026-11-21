#!/usr/bin/env node
/**
 * Diagnostic: OpenAI SDK Responses stream through LiteLLM (same surface as worker).
 */
import OpenAI from "openai";

const baseURL = process.env.OSVA_LITELLM_PROBE_BASE_URL;
const apiKey =
  process.env.OSVA_LITELLM_MASTER_KEY ?? "sk-osva-litellm-acceptance";
const model = process.env.OSVA_LITELLM_PROBE_MODEL ?? "gpt-test-snapshot";

if (!baseURL) {
  console.error("Set OSVA_LITELLM_PROBE_BASE_URL");
  process.exit(1);
}

const client = new OpenAI({
  apiKey,
  baseURL: `${baseURL.replace(/\/$/, "")}/v1`,
  maxRetries: 0,
});

const types = [];
let deltas = 0;
try {
  const stream = await client.responses.create({
    model,
    stream: true,
    input: [
      { role: "system", content: "You are concise." },
      { role: "user", content: "stream-success-check" },
    ],
  });
  for await (const event of stream) {
    types.push(event.type);
    if (event.type === "response.output_text.delta") {
      deltas += 1;
    }
    if (event.type === "response.completed") {
      console.log(
        JSON.stringify({
          status: "completed",
          eventTypes: types,
          deltaCount: deltas,
          responseStatus: event.response?.status,
          usage: event.response?.usage,
        }),
      );
      process.exit(0);
    }
  }
  console.log(
    JSON.stringify({
      status: "no_terminal",
      eventTypes: types,
      deltaCount: deltas,
    }),
  );
  process.exit(1);
} catch (error) {
  console.log(
    JSON.stringify({
      status: "error",
      message: String(error),
      eventTypes: types,
    }),
  );
  process.exit(1);
}
