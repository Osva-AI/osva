import http from "node:http";

export interface FakeOpenAiBatchServerOptions {
  /** When true, new batches stay in_progress until cancelled or advanced. */
  readonly deferCompletion?: boolean;
  /** Fail batch GET this many times before succeeding. */
  readonly statusPollFailuresRemaining?: number;
  /** Fail output file GET this many times before succeeding. */
  readonly resultsFetchFailuresRemaining?: number;
  /** Emit provider error rows for these correlation ids. */
  readonly failItemCorrelationIds?: readonly string[];
  /** Add successful rows for unknown correlation ids (not in input). */
  readonly extraOutputCorrelationIds?: readonly string[];
}

export interface FakeOpenAiBatchServer {
  readonly origin: string;
  readonly batchCreateCount: () => number;
  readonly cancelRequestCount: () => number;
  close(): Promise<void>;
}

export async function startFakeOpenAiBatchServer(
  options: FakeOpenAiBatchServerOptions = {},
): Promise<FakeOpenAiBatchServer> {
  const files = new Map<string, string>();
  const batches = new Map<
    string,
    {
      status: string;
      input_file_id: string;
      output_file_id?: string;
      correlation_ids: string[];
    }
  >();
  let fileCounter = 0;
  let batchCounter = 0;
  let batchCreates = 0;
  let cancelRequests = 0;
  let statusPollFailuresRemaining = options.statusPollFailuresRemaining ?? 0;
  let resultsFetchFailuresRemaining =
    options.resultsFetchFailuresRemaining ?? 0;
  const deferCompletion = options.deferCompletion === true;
  const failItemCorrelationIds = new Set(options.failItemCorrelationIds ?? []);
  const extraOutputCorrelationIds = options.extraOutputCorrelationIds ?? [];

  const server = http.createServer((req, res) => {
    const url = req.url ?? "/";
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const bodyText = Buffer.concat(chunks).toString("utf8");
      let body: unknown = {};
      if (bodyText.length > 0 && bodyText.trimStart().startsWith("{")) {
        body = JSON.parse(bodyText) as unknown;
      }

      const normalizedUrl = url.startsWith("/v1/") ? url : `/v1${url}`;

      if (normalizedUrl === "/v1/files" && req.method === "POST") {
        const id = `file_${++fileCounter}`;
        const jsonl = extractMultipartField(bodyText, "file") ?? bodyText;
        files.set(id, jsonl);
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ id, object: "file", purpose: "batch" }));
        return;
      }

      const fileMatch = normalizedUrl.match(/^\/v1\/files\/([^/]+)\/content$/);
      if (fileMatch && req.method === "GET") {
        if (resultsFetchFailuresRemaining > 0) {
          resultsFetchFailuresRemaining -= 1;
          res.writeHead(503, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "temporary_unavailable" }));
          return;
        }
        const fileId = fileMatch[1] ?? "";
        const content = files.get(fileId) ?? "";
        res.writeHead(200, { "content-type": "application/jsonl" });
        res.end(
          content || buildBatchOutput(jsonlIds([]), failItemCorrelationIds),
        );
        return;
      }

      if (normalizedUrl === "/v1/batches" && req.method === "POST") {
        batchCreates += 1;
        const input = body as { input_file_id?: string };
        const inputFileId = input.input_file_id ?? "file_0";
        const jsonl = files.get(inputFileId) ?? "";
        const correlationIds = parseCustomIdsFromJsonl(jsonl);
        const id = `batch_${++batchCounter}`;
        const outputFileId = `file_out_${id}`;
        const initialStatus = deferCompletion ? "in_progress" : "completed";
        const allOutputIds = [...correlationIds, ...extraOutputCorrelationIds];
        batches.set(id, {
          status: initialStatus,
          input_file_id: inputFileId,
          output_file_id: deferCompletion ? undefined : outputFileId,
          correlation_ids: correlationIds,
        });
        if (!deferCompletion) {
          files.set(
            outputFileId,
            buildBatchOutput(allOutputIds, failItemCorrelationIds),
          );
        }
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            id,
            object: "batch",
            status: initialStatus,
            input_file_id: inputFileId,
            output_file_id: deferCompletion ? undefined : outputFileId,
            request_counts: {
              total: correlationIds.length,
              completed: deferCompletion ? 0 : correlationIds.length,
              failed: 0,
            },
          }),
        );
        return;
      }

      const batchGetMatch = normalizedUrl.match(/^\/v1\/batches\/([^/]+)$/);
      if (batchGetMatch && req.method === "GET") {
        if (statusPollFailuresRemaining > 0) {
          statusPollFailuresRemaining -= 1;
          res.writeHead(503, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "temporary_unavailable" }));
          return;
        }
        const batchId = batchGetMatch[1] ?? "";
        const batch = batches.get(batchId);
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            id: batchId,
            status: batch?.status ?? "completed",
            output_file_id: batch?.output_file_id,
            request_counts: {
              total: batch?.correlation_ids.length ?? 1,
              completed:
                batch?.status === "completed" || batch?.status === "cancelled"
                  ? (batch?.correlation_ids.length ?? 1)
                  : 0,
              failed: 0,
            },
          }),
        );
        return;
      }

      const batchCancelMatch = normalizedUrl.match(
        /^\/v1\/batches\/([^/]+)\/cancel$/,
      );
      if (batchCancelMatch && req.method === "POST") {
        cancelRequests += 1;
        const batchId = batchCancelMatch[1] ?? "";
        const batch = batches.get(batchId);
        if (batch) {
          batch.status = "cancelled";
          const outputFileId = batch.output_file_id ?? `file_out_${batchId}`;
          batch.output_file_id = outputFileId;
          const partialIds =
            batch.correlation_ids.length > 1
              ? [batch.correlation_ids[0] as string]
              : [];
          files.set(
            outputFileId,
            buildBatchOutput(partialIds, failItemCorrelationIds),
          );
        }
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ id: batchId, status: "cancelled" }));
        return;
      }

      res.writeHead(404);
      res.end();
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("failed to bind fake openai batch server");
  }

  return {
    origin: `http://127.0.0.1:${address.port}`,
    batchCreateCount: () => batchCreates,
    cancelRequestCount: () => cancelRequests,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

function extractMultipartField(bodyText: string, field: string): string | null {
  const marker = `name="${field}"`;
  const idx = bodyText.indexOf(marker);
  if (idx < 0) return null;
  const start = bodyText.indexOf("\r\n\r\n", idx);
  if (start < 0) return null;
  const end = bodyText.indexOf("\r\n--", start + 4);
  return end < 0
    ? bodyText.slice(start + 4).trim()
    : bodyText.slice(start + 4, end).trim();
}

function parseCustomIdsFromJsonl(jsonl: string): string[] {
  const ids: string[] = [];
  for (const line of jsonl.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    try {
      const row = JSON.parse(trimmed) as { custom_id?: string };
      if (row.custom_id) ids.push(row.custom_id);
    } catch {
      // ignore
    }
  }
  return ids.length > 0 ? ids : ["corr_a"];
}

function jsonlIds(ids: string[]): string[] {
  return ids;
}

function buildBatchOutput(
  correlationIds: readonly string[],
  failIds: ReadonlySet<string>,
): string {
  if (correlationIds.length === 0) {
    return "";
  }
  const ids = [...correlationIds].reverse();
  return ids
    .map((customId, index) => {
      if (failIds.has(customId)) {
        return JSON.stringify({
          custom_id: customId,
          error: {
            message: `simulated failure for ${customId}`,
            code: "batch_item_failed",
          },
        });
      }
      return JSON.stringify({
        custom_id: customId,
        response: {
          body: {
            choices: [
              {
                message: { content: `result-${customId}` },
                finish_reason: "stop",
              },
            ],
            usage: {
              prompt_tokens: 3 + index,
              completion_tokens: 2,
              total_tokens: 5 + index,
            },
          },
          status_code: 200,
        },
      });
    })
    .join("\n");
}
