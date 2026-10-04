import http from "node:http";
import { afterEach, describe, expect, it } from "vitest";

import type { ConsoleConfig } from "../../src/server/config.js";
import { createConsoleServer } from "../../src/server/server.js";

describe("console OSVA proxy integration", () => {
  let upstream: http.Server | undefined;
  let consoleServer: http.Server | undefined;

  afterEach(async () => {
    for (const server of [consoleServer, upstream]) {
      if (server !== undefined) {
        await new Promise<void>((resolve, reject) => {
          server.close((error) => {
            if (error) {
              reject(error);
              return;
            }
            resolve();
          });
        });
      }
    }
    upstream = undefined;
    consoleServer = undefined;
  });

  it("forwards console reads to the public OSVA API with server-side Authorization", async () => {
    let capturedAuthorization: string | undefined;
    upstream = http.createServer((req, res) => {
      capturedAuthorization = req.headers.authorization;
      if (req.url === "/v1/auth/context") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            subjectId: "subject-int",
            workspaceId: "workspace-int",
            role: "operator",
          }),
        );
        return;
      }
      if (req.url === "/v1/runs") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ runs: [] }));
        return;
      }
      res.writeHead(404);
      res.end();
    });
    await new Promise<void>((resolve) => upstream!.listen(0, resolve));
    const upstreamAddress = upstream!.address();
    if (upstreamAddress === null || typeof upstreamAddress === "string") {
      throw new Error("expected upstream address");
    }

    const config: ConsoleConfig = {
      osvaBaseUrl: `http://127.0.0.1:${upstreamAddress.port}`,
      osvaApiKey: "integration-console-key",
      host: "127.0.0.1",
      port: 0,
      clientDistDir: "/tmp/unused",
    };

    consoleServer = createConsoleServer({ config });
    await new Promise<void>((resolve) => consoleServer!.listen(0, resolve));
    const consoleAddress = consoleServer!.address();
    if (consoleAddress === null || typeof consoleAddress === "string") {
      throw new Error("expected console address");
    }

    const authResponse = await fetch(
      `http://127.0.0.1:${consoleAddress.port}/api/v1/auth/context`,
    );
    const authBody = await authResponse.text();
    expect(authResponse.status).toBe(200);
    expect(JSON.parse(authBody)).toMatchObject({
      workspaceId: "workspace-int",
    });
    expect(authBody).not.toContain("integration-console-key");

    const runsResponse = await fetch(
      `http://127.0.0.1:${consoleAddress.port}/api/v1/runs`,
    );
    expect(runsResponse.status).toBe(200);

    expect(capturedAuthorization).toBe("Bearer integration-console-key");
  });
});
