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

      requests.push({
        method: req.method ?? "GET",
        url: req.url ?? "/",
        body,
      });

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

      if (prompt === "malformed") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ responseId: "gemini_bad" }));
        return;
      }

      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          responseId: "gemini_ok",
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
