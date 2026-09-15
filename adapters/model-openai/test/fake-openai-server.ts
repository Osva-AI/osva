import http from "node:http";

export interface FakeOpenAIResponsesServer {
  readonly origin: string;
  readonly requests: FakeOpenAIRequest[];
  close(): Promise<void>;
  waitForAbort(): Promise<void>;
}

export interface FakeOpenAIRequest {
  readonly method: string;
  readonly url: string;
  readonly body: unknown;
}

export async function startFakeOpenAIResponsesServer(): Promise<FakeOpenAIResponsesServer> {
  const requests: FakeOpenAIRequest[] = [];
  let abortWaiter: (() => void) | undefined;

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
        req.on("aborted", () => {
          abortWaiter?.();
        });
        return;
      }

      if (prompt === "auth-fail") {
        res.writeHead(401, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            error: {
              message: "invalid api key",
              type: "invalid_request_error",
            },
          }),
        );
        return;
      }

      if (prompt === "rate-limit") {
        res.writeHead(429, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            error: { message: "rate limited", type: "rate_limit_error" },
          }),
        );
        return;
      }

      if (prompt === "empty") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            id: "resp_empty",
            object: "response",
            status: "completed",
            output: [],
            output_text: "",
          }),
        );
        return;
      }

      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          id: "resp_ok",
          object: "response",
          status: "completed",
          output_text: "normalized text from fake openai",
          output: [
            {
              type: "message",
              role: "assistant",
              content: [
                {
                  type: "output_text",
                  text: "normalized text from fake openai",
                },
              ],
            },
          ],
          usage: {
            input_tokens: 120,
            output_tokens: 15,
            total_tokens: 135,
            input_tokens_details: {
              cached_tokens: 8,
              cache_write_tokens: 0,
            },
            output_tokens_details: {
              reasoning_tokens: 0,
            },
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
    throw new Error("Failed to bind fake OpenAI server.");
  }

  return {
    origin: `http://127.0.0.1:${String(address.port)}/v1`,
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
    waitForAbort() {
      return new Promise((resolve) => {
        abortWaiter = resolve;
      });
    },
  };
}

function extractPrompt(body: unknown): string {
  if (body === null || typeof body !== "object") {
    return "";
  }

  const record = body as Record<string, unknown>;
  if (typeof record.input === "string") {
    return record.input;
  }

  if (!Array.isArray(record.input)) {
    return "";
  }

  for (const item of record.input) {
    if (item === null || typeof item !== "object") {
      continue;
    }

    const message = item as Record<string, unknown>;
    if (typeof message.content === "string") {
      return message.content;
    }
  }

  return "";
}
