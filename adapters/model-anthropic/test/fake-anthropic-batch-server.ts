import http from "node:http";

export interface FakeAnthropicBatchServer {
  readonly origin: string;
  readonly batchCreateCount: () => number;
  readonly cancelRequestCount: () => number;
  close(): Promise<void>;
}

export interface FakeAnthropicBatchServerOptions {
  readonly deferCompletion?: boolean;
  readonly failCorrelationIds?: readonly string[];
}

export async function startFakeAnthropicBatchServer(
  options: FakeAnthropicBatchServerOptions = {},
): Promise<FakeAnthropicBatchServer> {
  const batches = new Map<
    string,
    {
      status: string;
      customIds: string[];
      cancelled: boolean;
    }
  >();
  let batchCounter = 0;
  let batchCreates = 0;
  let cancelRequests = 0;
  const deferCompletion = options.deferCompletion === true;
  const failSet = new Set(options.failCorrelationIds ?? []);

  const server = http.createServer((req, res) => {
    const url = req.url ?? "/";
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const bodyText = Buffer.concat(chunks).toString("utf8");
      let body: { requests?: Array<{ custom_id?: string }> } = {};
      if (bodyText.length > 0) {
        try {
          body = JSON.parse(bodyText) as typeof body;
        } catch {
          body = {};
        }
      }

      if (url === "/v1/messages/batches" && req.method === "POST") {
        batchCreates += 1;
        const customIds =
          body.requests?.map((r) => r.custom_id ?? "unknown") ?? [];
        const id = `msgbatch_${++batchCounter}`;
        const processingStatus = deferCompletion ? "in_progress" : "ended";
        batches.set(id, {
          status: processingStatus,
          customIds,
          cancelled: false,
        });
        const hostHeader = req.headers.host;
        const selfOrigin =
          hostHeader !== undefined ? `http://${hostHeader}` : "";
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            id,
            type: "message_batch",
            processing_status: processingStatus,
            results_url:
              processingStatus === "ended"
                ? `${selfOrigin}/v1/messages/batches/${id}/results`
                : undefined,
            request_counts: {
              processing: deferCompletion ? customIds.length : 0,
              succeeded: deferCompletion ? 0 : customIds.length,
              errored: 0,
              canceled: 0,
              expired: 0,
            },
          }),
        );
        return;
      }

      const retrieve = url.match(/^\/v1\/messages\/batches\/([^/]+)$/);
      if (retrieve && req.method === "GET") {
        const id = retrieve[1] ?? "";
        const batch = batches.get(id);
        res.writeHead(200, { "content-type": "application/json" });
        const processingStatus = batch?.cancelled
          ? "canceled"
          : (batch?.status ?? "ended");
        res.end(
          JSON.stringify({
            id,
            type: "message_batch",
            processing_status: processingStatus,
            results_url:
              processingStatus === "ended"
                ? `${req.headers.host ? `http://${String(req.headers.host)}` : ""}/v1/messages/batches/${id}/results`
                : undefined,
            request_counts: {
              processing: 0,
              succeeded: batch?.customIds.length ?? 0,
              errored: 0,
              canceled: batch?.cancelled ? 1 : 0,
              expired: 0,
            },
          }),
        );
        return;
      }

      const cancel = url.match(/^\/v1\/messages\/batches\/([^/]+)\/cancel$/);
      if (cancel && req.method === "POST") {
        cancelRequests += 1;
        const id = cancel[1] ?? "";
        const batch = batches.get(id);
        if (batch) {
          batch.cancelled = true;
          batch.status = "canceled";
        }
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            id,
            type: "message_batch",
            processing_status: "canceled",
          }),
        );
        return;
      }

      const results = url.match(/^\/v1\/messages\/batches\/([^/]+)\/results$/);
      if (results && req.method === "GET") {
        const id = results[1] ?? "";
        const batch = batches.get(id);
        const lines =
          batch?.customIds.map((customId) => {
            if (failSet.has(customId)) {
              return JSON.stringify({
                custom_id: customId,
                result: {
                  type: "errored",
                  error: {
                    type: "invalid_request_error",
                    message: "synthetic failure",
                  },
                },
              });
            }
            return JSON.stringify({
              custom_id: customId,
              result: {
                type: "succeeded",
                message: {
                  id: `msg_${customId}`,
                  type: "message",
                  role: "assistant",
                  content: [{ type: "text", text: `anthropic-${customId}` }],
                  model: "claude-3-5-sonnet-20241022",
                  stop_reason: "end_turn",
                  usage: {
                    input_tokens: 11,
                    output_tokens: 7,
                    cache_creation_input_tokens: 0,
                    cache_read_input_tokens: 0,
                  },
                },
              },
            });
          }) ?? [];
        const payload = lines.join("\n");
        res.writeHead(200, {
          "content-type": "application/x-jsonlines",
        });
        res.end(payload);
        return;
      }

      res.writeHead(404);
      res.end();
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("failed to bind fake anthropic batch server");
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
