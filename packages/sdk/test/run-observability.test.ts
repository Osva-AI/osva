import http from "node:http";
import { afterEach, describe, expect, it } from "vitest";

import { OsvaClient } from "../src/client.js";

describe("OsvaClient runObservability", () => {
  let server: http.Server | undefined;

  afterEach(async () => {
    if (server !== undefined) {
      await new Promise<void>((resolve, reject) => {
        server!.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
      server = undefined;
    }
  });

  it("lists run steps and loads usage", async () => {
    server = http.createServer((req, res) => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      if (
        req.method === "GET" &&
        url.pathname === "/v1/runs/run-1/attempts/attempt-1/steps"
      ) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            steps: [
              {
                id: "step-1",
                runId: "run-1",
                runAttemptId: "attempt-1",
                kind: "MODEL",
                bindingName: "primary",
                status: "SUCCEEDED",
                startedAt: "2026-01-01T00:00:00.000Z",
                completedAt: "2026-01-01T00:00:01.000Z",
              },
            ],
          }),
        );
        return;
      }
      if (
        req.method === "GET" &&
        url.pathname === "/v1/runs/run-1/attempts/attempt-1/usage"
      ) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            modelCalls: 1,
            toolCalls: 0,
            inputTokens: 10,
            outputTokens: 5,
            totalTokens: 15,
            cachedInputTokens: 0,
            estimatedCostUsdMicros: 100,
            pricedModelCalls: 1,
            unpricedModelCalls: 0,
          }),
        );
        return;
      }
      res.writeHead(404);
      res.end();
    });
    await new Promise<void>((resolve) => server!.listen(0, resolve));
    const address = server.address();
    if (address === null || typeof address === "string") {
      throw new Error("expected server address");
    }

    const client = new OsvaClient({
      baseUrl: `http://127.0.0.1:${address.port}`,
      apiKey: "test-key",
    });

    const steps = await client.runObservability.listSteps(
      "run-1" as never,
      "attempt-1" as never,
    );
    expect(steps.steps).toHaveLength(1);

    const usage = await client.runObservability.getUsage(
      "run-1" as never,
      "attempt-1" as never,
    );
    expect(usage.totalTokens).toBe(15);
  });
});
