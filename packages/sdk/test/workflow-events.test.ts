import http from "node:http";
import { afterEach, describe, expect, it } from "vitest";

import { OsvaClient } from "../src/client.js";

const TEST_API_KEY = "test-api-key";

describe("WorkflowEventsResource", () => {
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

  it("posts workflow events to /v1/workflow-events", async () => {
    const server = http.createServer((req, res) => {
      expect(req.method).toBe("POST");
      expect(req.url).toBe("/v1/workflow-events");
      res.writeHead(201, { "content-type": "application/json" });
      res.end(
        JSON.stringify({ id: "we-1", receivedAt: "2026-01-01T00:00:00.000Z" }),
      );
    });
    servers.push(server);
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    if (address === null || typeof address === "string") {
      throw new Error("Expected server to listen on a TCP port.");
    }

    const client = new OsvaClient({
      baseUrl: `http://127.0.0.1:${address.port}`,
      apiKey: TEST_API_KEY,
    });

    await expect(
      client.workflowEvents.ingest({
        source: "billing",
        eventType: "invoice.paid",
        correlationKey: "inv-1",
        idempotencyKey: "idem-1",
        payload: { ok: true },
      }),
    ).resolves.toMatchObject({ id: "we-1" });
  });
});
