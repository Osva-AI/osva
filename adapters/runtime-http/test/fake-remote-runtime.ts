import http from "node:http";

import {
  RUNTIME_CAPABILITY_PATHS,
  RUNTIME_PROTOCOL_VERSION,
  type RuntimeExecuteRequest,
} from "@osva/runtime-protocol";

export interface FakeRemoteRuntimeRequest {
  readonly body: RuntimeExecuteRequest;
  readonly authorization: string | undefined;
}

export interface FakeRemoteRuntimeOptions {
  readonly delayMs?: number;
  readonly status?: number;
  readonly redirectLocation?: string;
  readonly contentType?: string;
  readonly rawBody?: string;
  readonly response?: unknown;
  readonly oversizedBytes?: number;
  readonly callModel?: boolean;
  readonly callTool?: boolean;
  readonly callArtifact?: boolean;
  readonly dedupe?: boolean;
  readonly onExecute?: (
    request: FakeRemoteRuntimeRequest,
  ) => unknown | Promise<unknown>;
}

export interface FakeRemoteRuntime {
  readonly origin: string;
  readonly executeCount: number;
  readonly logicalExecuteCount: number;
  readonly lastRequest: FakeRemoteRuntimeRequest | undefined;
  readonly requests: readonly FakeRemoteRuntimeRequest[];
  close(): Promise<void>;
}

export async function startFakeRemoteRuntime(
  options: FakeRemoteRuntimeOptions = {},
): Promise<FakeRemoteRuntime> {
  const requests: FakeRemoteRuntimeRequest[] = [];
  const outcomes = new Map<string, unknown>();
  let logicalExecuteCount = 0;

  const server = http.createServer((req, res) => {
    void (async () => {
      if (options.delayMs !== undefined && options.delayMs > 0) {
        await new Promise((resolve) => {
          setTimeout(resolve, options.delayMs);
        });
      }

      if (req.method !== "POST" || req.url !== "/execute") {
        res.writeHead(404);
        res.end();
        return;
      }

      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      const raw = Buffer.concat(chunks).toString("utf8");
      let parsedBody: RuntimeExecuteRequest | undefined;
      try {
        parsedBody = JSON.parse(raw) as RuntimeExecuteRequest;
      } catch {
        parsedBody = undefined;
      }

      const recorded: FakeRemoteRuntimeRequest = {
        body:
          parsedBody ??
          ({
            protocolVersion: RUNTIME_PROTOCOL_VERSION,
            executionId: "invalid",
            input: null,
            capabilities: { endpoint: "", token: "" },
          } as RuntimeExecuteRequest),
        authorization: headerValue(req.headers.authorization),
      };
      requests.push(recorded);

      if (options.redirectLocation !== undefined) {
        res.writeHead(302, { location: options.redirectLocation });
        res.end();
        return;
      }

      if (options.oversizedBytes !== undefined) {
        const payload = "x".repeat(options.oversizedBytes);
        res.writeHead(200, {
          "content-type": options.contentType ?? "application/json",
          "content-length": String(Buffer.byteLength(payload)),
        });
        res.end(payload);
        return;
      }

      if (options.rawBody !== undefined) {
        res.writeHead(options.status ?? 200, {
          "content-type": options.contentType ?? "application/json",
        });
        res.end(options.rawBody);
        return;
      }

      if (options.status !== undefined && options.status >= 400) {
        res.writeHead(options.status, {
          "content-type": "application/json",
        });
        res.end(JSON.stringify({ error: "service" }));
        return;
      }

      let responseBody = options.response;
      if (parsedBody !== undefined && options.dedupe === true) {
        const existing = outcomes.get(parsedBody.executionId);
        if (existing !== undefined) {
          responseBody = existing;
        }
      }

      if (responseBody === undefined && parsedBody !== undefined) {
        logicalExecuteCount += 1;
        if (options.callModel === true) {
          const model = await fetchJson(
            `${parsedBody.capabilities.endpoint}${RUNTIME_CAPABILITY_PATHS.generateText}`,
            parsedBody.capabilities.token,
            {
              protocolVersion: RUNTIME_PROTOCOL_VERSION,
              executionId: parsedBody.executionId,
              bindingName: "primary",
              input: {
                messages: [{ role: "user", content: "hello from remote" }],
              },
            },
          );
          responseBody = {
            protocolVersion: RUNTIME_PROTOCOL_VERSION,
            executionId: parsedBody.executionId,
            outcome: "SUCCEEDED",
            output: {
              text: (model as { result?: { text?: string } }).result?.text,
            },
          };
        } else if (options.callTool === true) {
          const tool = await fetchJson(
            `${parsedBody.capabilities.endpoint}${RUNTIME_CAPABILITY_PATHS.invokeTool}`,
            parsedBody.capabilities.token,
            {
              protocolVersion: RUNTIME_PROTOCOL_VERSION,
              executionId: parsedBody.executionId,
              bindingName: "echo",
              input: parsedBody.input,
              idempotencyKey: "remote-echo-1",
            },
          );
          responseBody = {
            protocolVersion: RUNTIME_PROTOCOL_VERSION,
            executionId: parsedBody.executionId,
            outcome: "SUCCEEDED",
            output: (tool as { output?: unknown }).output ?? null,
          };
        } else if (options.callArtifact === true) {
          responseBody = await executeRemoteArtifactCapability(parsedBody);
        } else if (options.onExecute !== undefined) {
          responseBody = await options.onExecute(recorded);
        } else {
          responseBody = {
            protocolVersion: RUNTIME_PROTOCOL_VERSION,
            executionId: parsedBody.executionId,
            outcome: "SUCCEEDED",
            output: parsedBody.input,
          };
        }
        if (options.dedupe === true) {
          outcomes.set(parsedBody.executionId, responseBody);
        }
      }

      res.writeHead(options.status ?? 200, {
        "content-type": options.contentType ?? "application/json",
      });
      res.end(JSON.stringify(responseBody));
    })().catch(() => {
      res.writeHead(500);
      res.end();
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });

  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Fake remote runtime failed to bind.");
  }

  return {
    origin: `http://127.0.0.1:${String(address.port)}`,
    get executeCount() {
      return requests.length;
    },
    get logicalExecuteCount() {
      return logicalExecuteCount;
    },
    get lastRequest() {
      return requests[requests.length - 1];
    },
    get requests() {
      return requests;
    },
    close: () =>
      new Promise((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      }),
  };
}

function headerValue(
  value: string | readonly string[] | undefined,
): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value === "string") {
    return value;
  }
  return value[0];
}

async function fetchJson(
  url: string,
  token: string,
  body: unknown,
): Promise<unknown> {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  return response.json();
}

async function executeRemoteArtifactCapability(
  request: RuntimeExecuteRequest,
): Promise<unknown> {
  const input = request.input as { content?: string };
  const payload = input.content ?? "remote-http-artifact";
  const form = new FormData();
  form.append("executionId", request.executionId);
  form.append("name", "remote-artifact.txt");
  form.append("mediaType", "text/plain");
  form.append(
    "file",
    new Blob([payload], { type: "text/plain" }),
    "remote-artifact.txt",
  );

  const createResponse = await fetch(
    `${request.capabilities.endpoint}${RUNTIME_CAPABILITY_PATHS.artifactCreate}`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${request.capabilities.token}`,
      },
      body: form,
    },
  );
  const created = (await createResponse.json()) as {
    outcome?: string;
    artifact?: {
      id: string;
      reference?: { type: string; artifactId: string };
    };
  };
  if (created.outcome !== "SUCCEEDED" || created.artifact === undefined) {
    throw new Error("Remote artifact create failed.");
  }

  const metadata = await fetchJson(
    `${request.capabilities.endpoint}${RUNTIME_CAPABILITY_PATHS.artifactGet}`,
    request.capabilities.token,
    {
      protocolVersion: RUNTIME_PROTOCOL_VERSION,
      executionId: request.executionId,
      artifactId: created.artifact.id,
    },
  );
  const metadataArtifact = (metadata as { artifact?: { name?: string } })
    .artifact;
  if (metadataArtifact?.name !== "remote-artifact.txt") {
    throw new Error("Remote artifact metadata get failed.");
  }

  const contentUrl = new URL(
    `${request.capabilities.endpoint}${RUNTIME_CAPABILITY_PATHS.artifactContent}`,
  );
  contentUrl.searchParams.set("executionId", request.executionId);
  contentUrl.searchParams.set("artifactId", created.artifact.id);
  const contentResponse = await fetch(contentUrl, {
    headers: { authorization: `Bearer ${request.capabilities.token}` },
  });
  const roundTrip = await contentResponse.text();
  if (roundTrip !== payload) {
    throw new Error("Remote artifact content open failed.");
  }

  return {
    protocolVersion: RUNTIME_PROTOCOL_VERSION,
    executionId: request.executionId,
    outcome: "SUCCEEDED",
    output: {
      reference: created.artifact.reference,
      roundTrip,
    },
  };
}
