import http from "node:http";

export interface FakeAnthropicMessagesServer {
  readonly origin: string;
  readonly requests: FakeAnthropicRequest[];
  close(): Promise<void>;
}

export interface FakeAnthropicRequest {
  readonly method: string;
  readonly url: string;
  readonly body: unknown;
  readonly headers: Record<string, string | string[] | undefined>;
}

export async function startFakeAnthropicMessagesServer(): Promise<FakeAnthropicMessagesServer> {
  const requests: FakeAnthropicRequest[] = [];

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
        headers: { ...req.headers },
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
            type: "error",
            error: { type: "authentication_error", message: "invalid api key" },
          }),
        );
        return;
      }

      if (prompt === "rate-limit") {
        res.writeHead(429, {
          "content-type": "application/json",
          "retry-after": "2",
        });
        res.end(
          JSON.stringify({
            type: "error",
            error: { type: "rate_limit_error", message: "rate limited" },
          }),
        );
        return;
      }

      if (prompt === "not-found") {
        res.writeHead(404, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            type: "error",
            error: { type: "not_found_error", message: "model not found" },
          }),
        );
        return;
      }

      if (prompt === "invalid-request") {
        res.writeHead(400, {
          "content-type": "application/json",
          "request-id": "req_invalid_400",
        });
        res.end(
          JSON.stringify({
            type: "error",
            error: {
              type: "invalid_request_error",
              message: "invalid request",
            },
          }),
        );
        return;
      }

      if (prompt === "invalid-json-schema") {
        res.writeHead(400, {
          "content-type": "application/json",
          "request-id": "req_schema_400",
        });
        res.end(
          JSON.stringify({
            type: "error",
            error: {
              type: "invalid_request_error",
              message:
                "output_config.format.schema: For 'string' type, property 'pattern' is not supported",
            },
          }),
        );
        return;
      }

      if (prompt === "workspace-id-required") {
        res.writeHead(400, {
          "content-type": "application/json",
          "request-id": "req_workspace_400",
        });
        res.end(
          JSON.stringify({
            type: "error",
            error: {
              type: "invalid_request_error",
              message:
                "anthropic-workspace-id is required when authenticating with an identity-linked API key; send the id of the workspace this request acts in.",
            },
          }),
        );
        return;
      }

      if (prompt === "empty") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            id: "msg_empty",
            type: "message",
            role: "assistant",
            model: "claude-test",
            stop_reason: "end_turn",
            content: [],
            usage: { input_tokens: 0, output_tokens: 0 },
          }),
        );
        return;
      }

      if (prompt === "tool-use") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            id: "msg_tool",
            type: "message",
            role: "assistant",
            model: "claude-test",
            stop_reason: "tool_use",
            content: [{ type: "text", text: "partial tool output" }],
            usage: { input_tokens: 10, output_tokens: 5 },
          }),
        );
        return;
      }

      if (prompt === "usage-thinking-breakdown") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            id: "msg_thinking",
            type: "message",
            role: "assistant",
            model: "claude-test",
            stop_reason: "end_turn",
            content: [{ type: "text", text: "ok" }],
            usage: {
              input_tokens: 100,
              output_tokens: 348,
              output_tokens_details: { thinking_tokens: 312 },
              cache_read_input_tokens: 20,
              cache_creation_input_tokens: 5,
            },
          }),
        );
        return;
      }

      if (prompt === "builder-m20-json-schema") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            id: "msg_schema",
            type: "message",
            role: "assistant",
            model: "claude-test",
            stop_reason: "end_turn",
            content: [
              {
                type: "text",
                text: '{"schemaVersion":"1"}',
              },
            ],
            usage: { input_tokens: 50, output_tokens: 12 },
          }),
        );
        return;
      }

      if (prompt === "refusal") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            id: "msg_refusal",
            type: "message",
            role: "assistant",
            model: "claude-test",
            stop_reason: "refusal",
            content: [{ type: "text", text: "I cannot help with that." }],
            usage: { input_tokens: 10, output_tokens: 5 },
          }),
        );
        return;
      }

      if (prompt === "max-tokens") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            id: "msg_length",
            type: "message",
            role: "assistant",
            model: "claude-test",
            stop_reason: "max_tokens",
            content: [{ type: "text", text: '{"partial":true}' }],
            usage: { input_tokens: 10, output_tokens: 2048 },
          }),
        );
        return;
      }

      if (prompt === "malformed") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            id: "msg_bad",
            type: "message",
            role: "assistant",
            model: "claude-test",
            stop_reason: "end_turn",
            content: [],
          }),
        );
        return;
      }

      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          id: "msg_ok",
          type: "message",
          role: "assistant",
          model: "claude-test",
          stop_reason: "end_turn",
          content: [
            {
              type: "text",
              text: "normalized text from fake anthropic",
            },
          ],
          usage: {
            input_tokens: 120,
            output_tokens: 15,
            cache_read_input_tokens: 8,
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
    throw new Error("Failed to bind fake Anthropic server.");
  }

  return {
    origin: `http://127.0.0.1:${String(address.port)}`,
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
  if (!Array.isArray(record.messages)) {
    return "";
  }

  for (const item of record.messages) {
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
