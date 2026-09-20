import http from "node:http";
import { afterEach, describe, expect, it } from "vitest";

import { OsvaClient } from "../src/client.js";

const SAMPLE_SOURCE = {
  id: "ks-1",
  workspaceId: "ws-1",
  key: "handbook",
  name: "Handbook",
  artifactId: "artifact-1",
  attributes: { department: "finance" },
  createdAt: "2026-01-01T00:00:00.000Z",
};

const servers: http.Server[] = [];

describe("OsvaClient knowledge", () => {
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

  it("creates knowledge sources and retrieves semantic hits", async () => {
    const server = await startServer((req, res) => {
      if (req.method === "POST" && req.url === "/v1/knowledge-sources") {
        drainRequest(req, () => writeJson(res, 201, SAMPLE_SOURCE));
        return;
      }
      if (req.method === "POST" && req.url === "/v1/knowledge/retrieve") {
        drainRequest(req, () =>
          writeJson(res, 200, {
            hits: [
              {
                knowledgeChunkId: "kc-1",
                knowledgeIndexId: "ki-1",
                knowledgeSourceId: "ks-1",
                artifactReference: {
                  artifactId: "artifact-1",
                  name: "handbook.txt",
                  mediaType: "text/plain",
                  digest: `sha256:${"a".repeat(64)}`,
                },
                text: "refund policy",
                score: 0.92,
                attributes: { department: "finance" },
              },
            ],
          }),
        );
        return;
      }
      res.writeHead(404);
      res.end();
    });

    const client = new OsvaClient({
      baseUrl: server.origin,
      workspaceId: "ws-1" as never,
    });

    const created = await client.knowledgeSources.create({
      key: "handbook",
      name: "Handbook",
      artifactId: "artifact-1" as never,
    });
    expect(created.id).toBe("ks-1");

    const hits = await client.knowledge.retrieve({
      knowledgeIndexIds: ["ki-1" as never],
      query: "refund policy",
      topK: 3,
    });
    expect(hits.hits).toHaveLength(1);
    expect(hits.hits[0]?.text).toBe("refund policy");
  });
});

async function startServer(
  handler: (req: http.IncomingMessage, res: http.ServerResponse) => void,
): Promise<{ origin: string }> {
  const server = http.createServer(handler);
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Failed to bind test server.");
  }
  servers.push(server);
  return { origin: `http://127.0.0.1:${String(address.port)}` };
}

function drainRequest(req: http.IncomingMessage, onEnd: () => void): void {
  req.on("data", () => undefined);
  req.on("end", onEnd);
}

function writeJson(
  res: http.ServerResponse,
  status: number,
  body: unknown,
): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}
