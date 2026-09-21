import http from "node:http";
import { afterEach, describe, expect, it } from "vitest";

import { OsvaClient } from "../src/client.js";
import { OsvaApiError, OsvaTransportError } from "../src/errors.js";

const TEST_API_KEY = "osva_ak_test.secret";

describe("OsvaClient", () => {
  const servers: http.Server[] = [];

  afterEach(async () => {
    await Promise.all(
      servers.map(
        (server) =>
          new Promise<void>((resolve, reject) => {
            server.close((error) => {
              if (error) {
                reject(error);
                return;
              }
              resolve();
            });
          }),
      ),
    );
    servers.length = 0;
  });

  it("sends Authorization Bearer and omits client workspaceId on runs.create", async () => {
    let captured:
      { path: string; body: unknown; authorization?: string } | undefined;
    const server = await startMockServer(servers, (req, res, body) => {
      captured = {
        path: req.url ?? "",
        body,
        authorization: req.headers.authorization,
      };
      res.writeHead(201, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          run: {
            id: "run-1",
            workspaceId: "ws-1",
            agentId: "agent-1",
            status: "PENDING",
            effectiveBindings: {
              agentVersionId: "av-1",
              modelProfileVersionBindings: {},
              toolVersionBindings: {},
            },
            input: { hello: true },
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
          },
          runAttempt: {
            id: "attempt-1",
            runId: "run-1",
            sequence: 1,
            status: "PENDING",
            createdAt: "2026-01-01T00:00:00.000Z",
          },
        }),
      );
    });

    const client = new OsvaClient({
      baseUrl: `${server.origin}/`,
      apiKey: TEST_API_KEY,
    });

    await client.runs.create({
      agentId: "agent-1" as never,
      agentVersionId: "av-1" as never,
      input: { hello: true },
    });

    expect(captured?.path).toBe("/v1/runs");
    expect(captured?.authorization).toBe(`Bearer ${TEST_API_KEY}`);
    expect(captured?.body).toEqual({
      agentId: "agent-1",
      agentVersionId: "av-1",
      input: { hello: true },
    });
  });

  it("performs representative GET through agents.list", async () => {
    const server = await startMockServer(servers, (_req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ agents: [] }));
    });
    const client = new OsvaClient({
      baseUrl: server.origin,
      apiKey: TEST_API_KEY,
    });

    const result = await client.agents.list();
    expect(result.agents).toEqual([]);
  });

  it("maps API errors to OsvaApiError", async () => {
    const server = await startMockServer(servers, (_req, res) => {
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ status: "not_found" }));
    });
    const client = new OsvaClient({
      baseUrl: server.origin,
      apiKey: TEST_API_KEY,
    });

    await expect(client.agents.get("missing" as never)).rejects.toBeInstanceOf(
      OsvaApiError,
    );
    await expect(client.agents.get("missing" as never)).rejects.toMatchObject({
      status: 404,
      body: { status: "not_found" },
    });
  });

  it("maps transport failures to OsvaTransportError", async () => {
    const client = new OsvaClient({
      baseUrl: "http://127.0.0.1:1",
      apiKey: TEST_API_KEY,
      timeoutMs: 200,
    });

    await expect(client.agents.list()).rejects.toBeInstanceOf(
      OsvaTransportError,
    );
  });

  it("does not automatically retry mutation requests", async () => {
    let calls = 0;
    const server = await startMockServer(servers, (_req, res) => {
      calls += 1;
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ status: "internal_error" }));
    });
    const client = new OsvaClient({
      baseUrl: server.origin,
      apiKey: TEST_API_KEY,
    });

    await expect(
      client.runs.create({
        agentId: "agent-1" as never,
        agentVersionId: "av-1" as never,
        input: {},
      }),
    ).rejects.toBeInstanceOf(OsvaApiError);
    expect(calls).toBe(1);
  });

  it("freezes apiKey-only construction and representative resource clients", async () => {
    type ClientOptions = ConstructorParameters<typeof OsvaClient>[0];
    type NoWorkspaceId = "workspaceId" extends keyof ClientOptions
      ? never
      : true;
    const _assertWorkspace: NoWorkspaceId = true;
    expect(_assertWorkspace).toBe(true);

    const server = await startMockServer(servers, (_req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ apiKeys: [], workflows: [], runs: [] }));
    });
    const client = new OsvaClient({
      baseUrl: server.origin,
      apiKey: TEST_API_KEY,
    });

    await expect(client.apiKeys.list()).resolves.toMatchObject({ apiKeys: [] });
    await expect(client.workflows.list()).resolves.toMatchObject({
      workflows: [],
    });
    await expect(client.runs.list()).resolves.toMatchObject({ runs: [] });
  });
});

async function startMockServer(
  servers: http.Server[],
  handler: (
    req: http.IncomingMessage,
    res: http.ServerResponse,
    body: unknown,
  ) => void,
): Promise<{ origin: string; server: http.Server }> {
  const server = http.createServer((req, res) => {
    void (async () => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      const raw = Buffer.concat(chunks).toString("utf8").trim();
      const body = raw.length === 0 ? undefined : JSON.parse(raw);
      handler(req, res, body);
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
    throw new Error("Mock server failed to bind.");
  }

  servers.push(server);

  return {
    server,
    origin: `http://127.0.0.1:${String(address.port)}`,
  };
}
