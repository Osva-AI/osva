import http from "node:http";

export interface FakeGeminiGenerateContentServer {
  readonly origin: string;
  readonly requests: FakeGeminiRequest[];
  close(): Promise<void>;
}

export interface FakeGeminiRequest {
  readonly method: string;
  readonly url: string;
  readonly body: unknown;
}

export async function startFakeGeminiGenerateContentServer(): Promise<FakeGeminiGenerateContentServer> {
  const requests: FakeGeminiRequest[] = [];

  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
    });
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      let body: unknown = raw;
      try {
        body = raw.length === 0 ? {} : (JSON.parse(raw) as unknown);
      } catch {
        body = raw;
      }

      const url = req.url ?? "/";
      requests.push({
        method: req.method ?? "GET",
        url,
        body,
      });

      if (url.includes(":streamGenerateContent")) {
        writeGeminiStream(res, extractPrompt(body));
        return;
      }

      const prompt = extractPrompt(body);
      if (prompt === "hang") {
        req.on("aborted", () => undefined);
        return;
      }

      if (prompt === "auth-fail") {
        res.writeHead(401, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            error: {
              code: 401,
              message: "API key not valid.",
              status: "UNAUTHENTICATED",
            },
          }),
        );
        return;
      }

      if (prompt === "rate-limit") {
        res.writeHead(429, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            error: {
              code: 429,
              message: "Rate limited.",
              status: "RESOURCE_EXHAUSTED",
            },
          }),
        );
        return;
      }

      if (prompt === "quota-exhausted") {
        res.writeHead(429, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            error: {
              code: 429,
              message: "Quota exceeded for project.",
              status: "RESOURCE_EXHAUSTED",
            },
          }),
        );
        return;
      }

      if (prompt === "not-found") {
        res.writeHead(404, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            error: {
              code: 404,
              message: "Model not found.",
              status: "NOT_FOUND",
            },
          }),
        );
        return;
      }

      if (prompt === "empty") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            responseId: "gemini_empty",
            candidates: [
              {
                content: { parts: [{ text: "" }] },
                finishReason: "STOP",
              },
            ],
          }),
        );
        return;
      }

      if (prompt === "builder-m20-json-schema") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            responseId: "gemini_m20_schema_probe",
            candidates: [
              {
                content: {
                  parts: [
                    {
                      text: JSON.stringify({
                        schemaVersion: "1",
                        workflowRegistry: { key: "k", name: "n" },
                        agents: [],
                        workflow: { nodes: [], edges: [] },
                        assumptions: [],
                        unresolvedRequirements: [],
                      }),
                    },
                  ],
                },
                finishReason: "STOP",
              },
            ],
            usageMetadata: {
              promptTokenCount: 120,
              candidatesTokenCount: 15,
              totalTokenCount: 135,
            },
          }),
        );
        return;
      }

      if (prompt === "thinking-usage") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            responseId: "gemini_thinking",
            candidates: [
              {
                content: {
                  parts: [{ text: "normalized text from fake gemini" }],
                },
                finishReason: "STOP",
              },
            ],
            usageMetadata: {
              promptTokenCount: 100,
              candidatesTokenCount: 20,
              thoughtsTokenCount: 30,
              totalTokenCount: 150,
            },
          }),
        );
        return;
      }

      if (prompt === "provenance-no-model") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            responseId: "gemini_no_model",
            candidates: [
              {
                content: { parts: [{ text: "no model version" }] },
                finishReason: "STOP",
              },
            ],
            usageMetadata: {
              promptTokenCount: 10,
              candidatesTokenCount: 5,
              totalTokenCount: 15,
            },
          }),
        );
        return;
      }

      if (prompt === "provenance-no-usage") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            responseId: "gemini_no_usage",
            modelVersion: "gemini-2.0-flash-001",
            candidates: [
              {
                content: { parts: [{ text: "no usage" }] },
                finishReason: "STOP",
              },
            ],
          }),
        );
        return;
      }

      if (prompt === "provenance-cached-prompt") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            responseId: "gemini_cached",
            modelVersion: "gemini-2.0-flash-001",
            candidates: [
              {
                content: { parts: [{ text: "cached ok" }] },
                finishReason: "STOP",
              },
            ],
            usageMetadata: {
              promptTokenCount: 100,
              cachedContentTokenCount: 40,
              candidatesTokenCount: 12,
              totalTokenCount: 112,
            },
          }),
        );
        return;
      }

      if (prompt === "provenance-no-cached-breakdown") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            responseId: "gemini_no_cached",
            modelVersion: "gemini-2.0-flash-001",
            candidates: [
              {
                content: { parts: [{ text: "uncached" }] },
                finishReason: "STOP",
              },
            ],
            usageMetadata: {
              promptTokenCount: 80,
              candidatesTokenCount: 20,
              totalTokenCount: 100,
            },
          }),
        );
        return;
      }

      if (prompt === "provenance-tool-use-prompt-tokens") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            responseId: "gemini_tool_prompt",
            modelVersion: "gemini-2.0-flash-001",
            candidates: [
              {
                content: { parts: [{ text: "tool prompt" }] },
                finishReason: "STOP",
              },
            ],
            usageMetadata: {
              promptTokenCount: 90,
              toolUsePromptTokenCount: 30,
              candidatesTokenCount: 10,
              totalTokenCount: 100,
            },
          }),
        );
        return;
      }

      if (prompt === "provenance-provider-total-mismatch") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            responseId: "gemini_total_mismatch",
            modelVersion: "gemini-2.0-flash-001",
            candidates: [
              {
                content: { parts: [{ text: "total mismatch" }] },
                finishReason: "STOP",
              },
            ],
            usageMetadata: {
              promptTokenCount: 50,
              candidatesTokenCount: 10,
              thoughtsTokenCount: 5,
              totalTokenCount: 80,
            },
          }),
        );
        return;
      }

      if (prompt === "provenance-partial-usage") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            responseId: "gemini_partial",
            modelVersion: "gemini-2.0-flash-001",
            candidates: [
              {
                content: { parts: [{ text: "partial" }] },
                finishReason: "STOP",
              },
            ],
            usageMetadata: {
              promptTokenCount: 25,
            },
          }),
        );
        return;
      }

      if (prompt === "provenance-zero-usage") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            responseId: "gemini_zero",
            modelVersion: "gemini-zero",
            candidates: [
              {
                content: { parts: [{ text: "zero" }] },
                finishReason: "STOP",
              },
            ],
            usageMetadata: {
              promptTokenCount: 0,
              candidatesTokenCount: 0,
              totalTokenCount: 0,
            },
          }),
        );
        return;
      }

      if (prompt === "provenance-invalid-tokens") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            responseId: "gemini_invalid",
            modelVersion: "gemini-invalid",
            candidates: [
              {
                content: { parts: [{ text: "invalid" }] },
                finishReason: "STOP",
              },
            ],
            usageMetadata: {
              promptTokenCount: 10,
              candidatesTokenCount: 5,
              totalTokenCount: 5,
            },
          }),
        );
        return;
      }

      if (prompt === "malformed") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ responseId: "gemini_bad" }));
        return;
      }

      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          responseId: "gemini_ok",
          modelVersion: "gemini-2.0-flash-001",
          candidates: [
            {
              content: {
                parts: [{ text: "normalized text from fake gemini" }],
              },
              finishReason: "STOP",
            },
          ],
          usageMetadata: {
            promptTokenCount: 120,
            candidatesTokenCount: 15,
            totalTokenCount: 135,
          },
        }),
      );
    });
  });

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve();
    });
  });

  const address = server.address();
  if (typeof address !== "object" || address === null) {
    throw new Error("Failed to bind fake Gemini server.");
  }

  return {
    origin: `http://127.0.0.1:${String(address.port)}/v1beta`,
    requests,
    async close() {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    },
  };
}

function writeGeminiStream(res: http.ServerResponse, prompt: string): void {
  if (prompt === "auth-fail") {
    res.writeHead(401, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        error: {
          code: 401,
          message: "API key not valid.",
          status: "UNAUTHENTICATED",
        },
      }),
    );
    return;
  }

  const text = "normalized text from fake gemini";
  res.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache",
    connection: "keep-alive",
  });

  const first = text.slice(0, 12);
  const second = text.slice(12);
  const emit = (payload: unknown) => {
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };

  emit({
    responseId: "gemini_stream",
    candidates: [{ content: { parts: [{ text: first }] } }],
  });
  emit({
    responseId: "gemini_stream",
    candidates: [
      {
        content: { parts: [{ text }] },
        finishReason: "STOP",
      },
    ],
    usageMetadata: {
      promptTokenCount: 120,
      candidatesTokenCount: 15,
      totalTokenCount: 135,
    },
  });
  if (second.length > 0) {
    void second;
  }
  res.end();
}

function extractPrompt(body: unknown): string {
  if (body === null || typeof body !== "object") {
    return "";
  }

  const record = body as Record<string, unknown>;
  if (!Array.isArray(record.contents)) {
    return "";
  }

  for (const item of record.contents) {
    if (item === null || typeof item !== "object") {
      continue;
    }

    const content = item as Record<string, unknown>;
    if (!Array.isArray(content.parts)) {
      continue;
    }

    for (const part of content.parts) {
      if (part === null || typeof part !== "object") {
        continue;
      }

      const textPart = part as Record<string, unknown>;
      if (typeof textPart.text === "string") {
        return textPart.text;
      }
    }
  }

  return "";
}
