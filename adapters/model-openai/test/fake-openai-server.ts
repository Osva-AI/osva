import http from "node:http";

import { resolveM20_6BuilderFakeProposal } from "./m20-6-builder-scenario-responses.js";

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

      const url = req.url ?? "/";

      requests.push({
        method: req.method ?? "GET",
        url,
        body,
      });

      if (url.includes("/chat/completions")) {
        writeChatCompletionResponse(body, res);
        return;
      }

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

function writeChatCompletionChatError(
  userText: string,
  res: http.ServerResponse,
): boolean {
  const scenarios: Record<
    string,
    { status: number; type: string; code?: string; param?: string }
  > = {
    "openai-error-400": {
      status: 400,
      type: "invalid_request_error",
      code: "invalid_json_schema",
      param: "response_format",
    },
    "openai-error-400-unsupported-parameter": {
      status: 400,
      type: "invalid_request_error",
      code: "unsupported_parameter",
      param: "max_tokens",
    },
    "openai-error-401": {
      status: 401,
      type: "invalid_request_error",
      code: "invalid_api_key",
    },
    "openai-error-403": {
      status: 403,
      type: "permission_error",
      code: "insufficient_quota",
    },
    "openai-error-429": {
      status: 429,
      type: "rate_limit_error",
      code: "rate_limit_exceeded",
    },
    "openai-error-500": {
      status: 500,
      type: "server_error",
      code: "internal_error",
    },
  };

  const ordered = Object.entries(scenarios).sort(
    (a, b) => b[0].length - a[0].length,
  );
  for (const [marker, scenario] of ordered) {
    if (!userText.includes(marker)) {
      continue;
    }

    res.writeHead(scenario.status, {
      "content-type": "application/json",
      "x-request-id": "req_fake_openai_error",
      ...(scenario.status === 429 ? { "retry-after": "2" } : {}),
    });
    res.end(
      JSON.stringify({
        error: {
          message: "synthetic provider error",
          type: scenario.type,
          code: scenario.code,
          param: scenario.param,
        },
      }),
    );
    return true;
  }

  return false;
}

function writeChatCompletionResponse(
  body: unknown,
  res: http.ServerResponse,
): void {
  const userText = extractChatUserText(body);
  if (writeChatCompletionChatError(userText, res)) {
    return;
  }

  const record =
    body !== null && typeof body === "object"
      ? (body as Record<string, unknown>)
      : {};
  const tools = record.tools;
  const hasTools = Array.isArray(tools) && tools.length > 0;
  const scenario = extractChatScenario(body);
  const usage = {
    prompt_tokens: 120,
    completion_tokens: 15,
    total_tokens: 135,
  };

  const messages = record.messages;
  const hasToolResults =
    Array.isArray(messages) &&
    messages.some(
      (message) =>
        message !== null &&
        typeof message === "object" &&
        (message as Record<string, unknown>).role === "tool",
    );

  if (hasTools && !hasToolResults) {
    const toolName =
      scenario === "declarative-unauthorized" ? "blocked" : "echo";
    const argumentsJson =
      toolName === "echo"
        ? JSON.stringify({ value: "declarative-tool-input" })
        : JSON.stringify({ value: "blocked" });

    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        id: "chat_tool",
        object: "chat.completion",
        choices: [
          {
            index: 0,
            finish_reason: "tool_calls",
            message: {
              role: "assistant",
              content: null,
              tool_calls: [
                {
                  id: "call_declarative_1",
                  type: "function",
                  function: { name: toolName, arguments: argumentsJson },
                },
              ],
            },
          },
        ],
        usage,
      }),
    );
    return;
  }

  const m20BuilderProposal = resolveM20_6BuilderFakeProposal(userText);
  if (m20BuilderProposal !== undefined) {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        id: "chat_m20_6_builder",
        object: "chat.completion",
        choices: [
          {
            index: 0,
            finish_reason: "stop",
            message: {
              role: "assistant",
              content: JSON.stringify(m20BuilderProposal),
            },
          },
        ],
        usage,
      }),
    );
    return;
  }

  if (userText.includes("builder-m20-json-schema")) {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        id: "chat_m20_schema_probe",
        object: "chat.completion",
        choices: [
          {
            index: 0,
            finish_reason: "stop",
            message: {
              role: "assistant",
              content: JSON.stringify({
                schemaVersion: "1",
                workflowRegistry: { key: "k", name: "n" },
                agents: [],
                workflow: { nodes: [], edges: [] },
                assumptions: [],
                unresolvedRequirements: [],
              }),
            },
          },
        ],
        usage,
      }),
    );
    return;
  }

  let answer =
    scenario === "declarative-tool-flow"
      ? "declarative-after-tool"
      : "declarative-ok";
  if (userText.includes("declarative-knowledge-probe")) {
    answer = userText.includes(DECLARATIVE_KNOWLEDGE_PROBE_MARKER)
      ? "declarative-knowledge-ok"
      : "declarative-knowledge-miss";
  }

  res.writeHead(200, { "content-type": "application/json" });
  res.end(
    JSON.stringify({
      id: "chat_json",
      object: "chat.completion",
      choices: [
        {
          index: 0,
          finish_reason: "stop",
          message: {
            role: "assistant",
            content: JSON.stringify({ answer }),
          },
        },
      ],
      usage,
    }),
  );
}

const DECLARATIVE_KNOWLEDGE_PROBE_MARKER = "OSVA_DECLARATIVE_KB_PROBE_MARKER";

function extractChatUserText(body: unknown): string {
  if (body === null || typeof body !== "object") {
    return "";
  }
  const record = body as Record<string, unknown>;
  const messages = record.messages;
  if (!Array.isArray(messages)) {
    return "";
  }
  const parts: string[] = [];
  for (const message of messages) {
    if (message === null || typeof message !== "object") {
      continue;
    }
    const role = (message as Record<string, unknown>).role;
    const content = (message as Record<string, unknown>).content;
    if (role === "user" && typeof content === "string") {
      parts.push(content);
    }
  }
  return parts.join("\n");
}

function extractChatScenario(body: unknown): string {
  if (body === null || typeof body !== "object") {
    return "";
  }

  const record = body as Record<string, unknown>;
  const messages = record.messages;
  if (!Array.isArray(messages)) {
    return "";
  }

  for (const message of messages) {
    if (message === null || typeof message !== "object") {
      continue;
    }
    const content = (message as Record<string, unknown>).content;
    if (typeof content !== "string") {
      continue;
    }
    if (content.includes("declarative-unauthorized")) {
      return "declarative-unauthorized";
    }
    if (content.includes("declarative-tool-flow")) {
      return "declarative-tool-flow";
    }
  }

  return "";
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
