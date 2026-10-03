import http from "node:http";

export interface FakeCanonicalModelRequest {
  readonly method: string;
  readonly url: string;
  readonly body: unknown;
}

export interface FakeCanonicalModelServer {
  readonly origin: string;
  readonly callCount: number;
  readonly requests: readonly FakeCanonicalModelRequest[];
  close(): Promise<void>;
  resetCallCount(): void;
  queueFailure(status: number, message?: string): void;
  queueMalformedResponse(text: string): void;
}

export interface FakeCanonicalModelOptions {
  readonly reportMarkdown?: string;
}

const DEFAULT_REPORT_MARKDOWN = [
  "# Dependency adoption review",
  "",
  "Package: zod",
  "Request: req-canonical-demo-001",
  "",
  "## Recommendation",
  "",
  "Disposition: **PILOT**",
  "Confidence: **HIGH**",
  "",
  "Pilot approved for tier-1 validation with MIT license alignment.",
].join("\n");

const CANONICAL_USAGE = {
  input_tokens: 100,
  output_tokens: 50,
  total_tokens: 150,
  input_tokens_details: {
    cached_tokens: 0,
    cache_write_tokens: 0,
  },
  output_tokens_details: {
    reasoning_tokens: 0,
  },
} as const;

export async function startFakeCanonicalModelServer(
  options: FakeCanonicalModelOptions = {},
): Promise<FakeCanonicalModelServer> {
  const reportMarkdown = options.reportMarkdown ?? DEFAULT_REPORT_MARKDOWN;
  let callCount = 0;
  const requests: FakeCanonicalModelRequest[] = [];
  const failureQueue: Array<{ status: number; message: string }> = [];
  const malformedQueue: string[] = [];

  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
    });
    req.on("end", () => {
      callCount += 1;
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

      const failure = failureQueue.shift();
      if (failure !== undefined) {
        res.writeHead(failure.status, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            error: { message: failure.message, type: "invalid_request_error" },
          }),
        );
        return;
      }

      const malformed = malformedQueue.shift();
      if (malformed !== undefined) {
        respondOpenAI(res, malformed);
        return;
      }

      const prompt = extractPromptText(body);
      const analysisResponse = JSON.stringify({
        disposition: "PILOT",
        confidence: "HIGH",
        summary:
          "Evidence supports a time-boxed pilot; MIT license aligns with ExampleCo preferred list.",
        criteria: [
          {
            criterion: "license-compatibility",
            status: "PASS",
            rationale: "MIT license is on the preferred list.",
            evidenceRefs: ["policy:license", "npm:license"],
          },
        ],
        risks: ["Major version drift may fragment validation behavior."],
        openQuestions: ["Does the team already standardize on zod v4?"],
      });

      if (isAnalysisPrompt(prompt)) {
        respondOpenAI(res, analysisResponse);
        return;
      }

      if (isResearchSynthesisPrompt(prompt)) {
        respondOpenAI(
          res,
          JSON.stringify({
            findings: [
              "MIT license reported by deterministic npm metadata.",
              "Download volume indicates broad adoption.",
            ],
            warnings: ["Confirm major-version migration path for zod v4."],
          }),
        );
        return;
      }

      if (
        prompt.includes(
          "write professional dependency adoption review reports",
        ) ||
        prompt.includes("dependency adoption review reports in Markdown")
      ) {
        respondOpenAI(res, reportMarkdown);
        return;
      }

      res.writeHead(500, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          error: {
            message: "Unrecognized canonical fake model prompt phase.",
            type: "invalid_request_error",
          },
        }),
      );
    });
  });

  server.on("clientError", (_error, socket) => {
    socket.end("HTTP/1.1 400 Bad Request\r\n\r\n");
  });

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve();
    });
  });

  const address = server.address();
  if (typeof address !== "object" || address === null) {
    throw new Error("Failed to bind fake canonical model server.");
  }

  return {
    origin: `http://127.0.0.1:${String(address.port)}/v1`,
    get callCount() {
      return callCount;
    },
    get requests() {
      return requests;
    },
    resetCallCount() {
      callCount = 0;
      requests.length = 0;
    },
    queueFailure(status: number, message = "simulated model failure") {
      failureQueue.push({ status, message });
    },
    queueMalformedResponse(text: string) {
      malformedQueue.push(text);
    },
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

function respondOpenAI(res: http.ServerResponse, text: string): void {
  res.writeHead(200, { "content-type": "application/json" });
  res.end(
    JSON.stringify({
      id: "resp_canonical",
      object: "response",
      status: "completed",
      output_text: text,
      output: [
        {
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text }],
        },
      ],
      usage: CANONICAL_USAGE,
    }),
  );
}

function isAnalysisPrompt(prompt: string): boolean {
  return (
    prompt.includes("dependency adoption analyst") ||
    prompt.includes("repair malformed JSON analysis")
  );
}

function isResearchSynthesisPrompt(prompt: string): boolean {
  return (
    prompt.includes("engineering dependency research analyst") ||
    prompt.includes("Return strict JSON only with keys findings and warnings")
  );
}

function extractPromptText(body: unknown): string {
  if (body === null || typeof body !== "object") {
    return "";
  }
  const record = body as Record<string, unknown>;
  const parts: string[] = [];
  if (typeof record.instructions === "string") {
    parts.push(record.instructions);
  }
  if (typeof record.input === "string") {
    parts.push(record.input);
  } else if (Array.isArray(record.input)) {
    for (const item of record.input) {
      if (item === null || typeof item !== "object") {
        continue;
      }
      const message = item as Record<string, unknown>;
      if (typeof message.content === "string") {
        parts.push(message.content);
      }
    }
  }
  return parts.join("\n");
}
