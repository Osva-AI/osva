#!/usr/bin/env node
/**
 * Optional operator profile: one OpenAI-compatible call against a local Ollama (or compatible) server.
 * Skips with exit 0 when OSVA_M12_3_OLLAMA_BASE_URL is unset.
 */
const baseUrl = process.env.OSVA_M12_3_OLLAMA_BASE_URL;
const model = process.env.OSVA_M12_3_OLLAMA_MODEL ?? "llama3.2";

if (!baseUrl) {
  console.log(
    JSON.stringify({
      profile: "ollama-optional",
      status: "SKIPPED",
      reason: "OSVA_M12_3_OLLAMA_BASE_URL not set",
    }),
  );
  process.exit(0);
}

const response = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    model,
    messages: [{ role: "user", content: "Reply with exactly: ollama-ok" }],
    max_tokens: 16,
  }),
});

const text = await response.text();
if (!response.ok) {
  console.error(text.slice(0, 500));
  process.exit(1);
}

console.log(
  JSON.stringify({
    profile: "ollama-optional",
    status: "PASS",
    httpStatus: response.status,
    model,
    baseUrl,
    bodyPreview: text.slice(0, 200),
  }),
);
