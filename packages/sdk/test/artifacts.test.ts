import http from "node:http";
import { afterEach, describe, expect, it } from "vitest";

import { OsvaClient } from "../src/client.js";
import { OsvaApiError } from "../src/errors.js";

const SAMPLE_ARTIFACT = {
  id: "artifact-1",
  workspaceId: "ws-1",
  name: "sample.bin",
  mediaType: "application/octet-stream",
  sizeBytes: 3,
  digest: `sha256:${"a".repeat(64)}`,
  metadata: {},
  createdAt: "2026-01-01T00:00:00.000Z",
};

const servers: http.Server[] = [];

describe("OsvaClient artifacts", () => {
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

  it("creates artifacts with multipart upload", async () => {
    let contentType: string | undefined;
    const server = await startServer((req, res) => {
      if (req.method === "POST" && req.url === "/v1/artifacts") {
        contentType = req.headers["content-type"];
        drainRequest(req, () => {
          writeJson(res, 201, SAMPLE_ARTIFACT);
        });
        return;
      }
      res.writeHead(404);
      res.end();
    });

    const client = new OsvaClient({
      baseUrl: server.origin,
      apiKey: "osva_ak_test.secret" as never,
    });

    const created = await client.artifacts.create({
      name: "sample.bin",
      content: new Blob([Uint8Array.from([1, 2, 3])]),
    });

    expect(contentType).toContain("multipart/form-data");
    expect(created.id).toBe("artifact-1");
  });

  it("loads artifact metadata through get and list", async () => {
    const server = await startServer((req, res) => {
      if (req.method === "GET" && req.url === "/v1/artifacts/artifact-1") {
        writeJson(res, 200, SAMPLE_ARTIFACT);
        return;
      }
      if (
        req.method === "GET" &&
        (req.url === "/v1/artifacts" || req.url?.startsWith("/v1/artifacts?"))
      ) {
        writeJson(res, 200, { items: [SAMPLE_ARTIFACT] });
        return;
      }
      res.writeHead(404);
      res.end();
    });

    const client = new OsvaClient({
      baseUrl: server.origin,
      apiKey: "osva_ak_test.secret" as never,
    });

    const artifact = await client.artifacts.get("artifact-1" as never);
    expect(artifact.name).toBe("sample.bin");

    const page = await client.artifacts.list();
    expect(page.items).toHaveLength(1);
  });

  it("downloads artifact bytes", async () => {
    const payload = Uint8Array.from([0xde, 0xad, 0xbe, 0xef]);
    const server = await startServer((req, res) => {
      if (
        req.method === "GET" &&
        req.url === "/v1/artifacts/artifact-1/content"
      ) {
        res.writeHead(200, {
          "content-type": "application/octet-stream",
          "content-disposition": 'attachment; filename="sample.bin"',
        });
        res.end(Buffer.from(payload));
        return;
      }
      res.writeHead(404);
      res.end();
    });

    const client = new OsvaClient({
      baseUrl: server.origin,
      apiKey: "osva_ak_test.secret" as never,
    });

    const downloaded = await client.artifacts.download("artifact-1" as never);
    expect(downloaded.body).not.toBeNull();
    const bytes = new Uint8Array(
      await new Response(downloaded.body).arrayBuffer(),
    );
    expect(bytes).toEqual(payload);
  });

  it("propagates artifact API errors", async () => {
    const server = await startServer((req, res) => {
      if (req.method === "GET" && req.url === "/v1/artifacts/missing") {
        writeJson(res, 404, { status: "not_found" });
        return;
      }
      res.writeHead(404);
      res.end();
    });

    const client = new OsvaClient({
      baseUrl: server.origin,
      apiKey: "osva_ak_test.secret" as never,
    });

    await expect(
      client.artifacts.get("missing" as never),
    ).rejects.toBeInstanceOf(OsvaApiError);
  });
});

async function startServer(
  handler: (req: http.IncomingMessage, res: http.ServerResponse) => void,
): Promise<{ origin: string; server: http.Server }> {
  const server = http.createServer(handler);
  servers.push(server);

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

  return { server, origin: `http://127.0.0.1:${String(address.port)}` };
}

function writeJson(
  res: http.ServerResponse,
  status: number,
  body: unknown,
): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

function drainRequest(req: http.IncomingMessage, onComplete: () => void): void {
  req.on("data", () => {});
  req.on("end", onComplete);
}
