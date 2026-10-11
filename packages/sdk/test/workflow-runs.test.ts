import http from "node:http";
import { afterEach, describe, expect, it } from "vitest";

import { OsvaClient } from "../src/client.js";

const TEST_API_KEY = "test-api-key";

describe("WorkflowRunsResource", () => {
  const servers: http.Server[] = [];

  afterEach(async () => {
    await Promise.all(
      servers.splice(0).map(
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
  });

  it("lists WorkflowRuns via GET /v1/workflow-runs", async () => {
    const server = await startMockServer(servers, (req, res) => {
      expect(req.method).toBe("GET");
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      expect(url.pathname).toBe("/v1/workflow-runs");
      expect(url.searchParams.get("workflowId")).toBe("wf-1");
      expect(url.searchParams.get("workflowVersionId")).toBe("wv-1");
      expect(url.searchParams.get("status")).toBe("PENDING");
      expect(url.searchParams.get("limit")).toBe("10");
      expect(url.searchParams.get("cursor")).toBe("abc");
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          workflowRuns: [
            {
              id: "wr-1",
              workspaceId: "ws-1",
              workflowId: "wf-1",
              workflowVersionId: "wv-1",
              status: "PENDING",
              createdAt: "2026-01-01T00:00:00.000Z",
              updatedAt: "2026-01-01T00:00:00.000Z",
            },
          ],
        }),
      );
    });
    const client = new OsvaClient({
      baseUrl: server.origin,
      apiKey: TEST_API_KEY,
    });

    await expect(
      client.workflowRuns.list({
        workflowId: "wf-1",
        workflowVersionId: "wv-1",
        status: "PENDING",
        limit: 10,
        cursor: "abc",
      }),
    ).resolves.toMatchObject({
      workflowRuns: [{ id: "wr-1", status: "PENDING" }],
    });
  });
});

async function startMockServer(
  servers: http.Server[],
  handler: (req: http.IncomingMessage, res: http.ServerResponse) => void,
): Promise<{ origin: string; server: http.Server }> {
  const server = http.createServer(handler);
  servers.push(server);
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Expected server to listen on a TCP port.");
  }
  return { origin: `http://127.0.0.1:${String(address.port)}`, server };
}
