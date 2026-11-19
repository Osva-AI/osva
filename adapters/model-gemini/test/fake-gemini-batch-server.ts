import http from "node:http";

export interface FakeGeminiBatchServer {
  readonly origin: string;
  readonly batchCreateCount: () => number;
  readonly cancelRequestCount: () => number;
  close(): Promise<void>;
}

export async function startFakeGeminiBatchServer(): Promise<FakeGeminiBatchServer> {
  const operations = new Map<
    string,
    {
      state: string;
      model: string;
      requestIds: string[];
    }
  >();
  let batchCreates = 0;
  let cancelRequests = 0;
  let opCounter = 0;

  const server = http.createServer((req, res) => {
    const urlPath = req.url?.split("?")[0] ?? "/";
    const url = decodeURIComponent(urlPath);
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const bodyText = Buffer.concat(chunks).toString("utf8");
      let body: {
        batch?: {
          requests?: Array<{
            request_id?: string;
          }>;
        };
      } = {};
      if (bodyText.length > 0) {
        try {
          body = JSON.parse(bodyText) as typeof body;
        } catch {
          body = {};
        }
      }

      const createMatch = url.match(
        /^\/v1beta\/models\/([^:]+):batchGenerateContent$/,
      );
      if (createMatch && req.method === "POST") {
        batchCreates += 1;
        const model = decodeURIComponent(createMatch[1] ?? "gemini-1.5-flash");
        const requestIds =
          body.batch?.requests?.map((r) => r.request_id ?? "unknown") ?? [];
        const name = `operations/batch_${++opCounter}`;
        operations.set(name, {
          state: "BATCH_STATE_SUCCEEDED",
          model,
          requestIds,
        });
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            name,
            state: "BATCH_STATE_SUCCEEDED",
          }),
        );
        return;
      }

      const opGet = url.match(/^\/v1beta\/(operations\/[^/]+)$/);
      const opGetRoot = url.match(/^(?:\/v1beta)?\/(operations\/[^/]+)$/);
      const opPath = opGet?.[1] ?? (opGetRoot ? opGetRoot[1] : undefined);
      if (opPath && req.method === "GET" && !url.endsWith("/results")) {
        const fullName = opPath.startsWith("operations/")
          ? opPath
          : `operations/${opPath}`;
        const op = operations.get(fullName);
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            name: fullName,
            state: op?.state ?? "BATCH_STATE_SUCCEEDED",
          }),
        );
        return;
      }

      const results =
        url.match(/^\/v1beta\/(operations\/[^/]+)\/results$/) ??
        url.match(/^(?:\/v1beta)?\/(operations\/[^/]+)\/results$/);
      if (results && req.method === "GET") {
        const fullName = results[1] ?? "";
        const op = operations.get(fullName);
        const rows =
          op?.requestIds.map((requestId) => ({
            request_id: requestId,
            response: {
              candidates: [
                {
                  content: {
                    parts: [{ text: `gemini-${requestId}` }],
                  },
                },
              ],
              usageMetadata: {
                promptTokenCount: 10,
                candidatesTokenCount: 6,
                totalTokenCount: 16,
              },
            },
          })) ?? [];
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ responses: rows }));
        return;
      }

      const cancel =
        url.match(/^\/v1beta\/(operations\/[^/]+):cancel$/) ??
        url.match(/^(?:\/v1beta)?\/(operations\/[^/]+):cancel$/);
      if (cancel && req.method === "POST") {
        cancelRequests += 1;
        const fullName = cancel[1] ?? "";
        const op = operations.get(fullName);
        if (op) op.state = "BATCH_STATE_CANCELLED";
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            name: fullName,
            state: "BATCH_STATE_CANCELLED",
          }),
        );
        return;
      }

      res.writeHead(404);
      res.end();
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("failed to bind fake gemini batch server");
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
