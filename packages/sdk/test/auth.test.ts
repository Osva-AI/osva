import http from "node:http";
import { afterEach, describe, expect, it } from "vitest";

import { OsvaClient } from "../src/client.js";

describe("OsvaClient auth", () => {
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

  it("loads auth context with bearer authorization", async () => {
    let capturedAuth: string | undefined;
    server = http.createServer((req, res) => {
      capturedAuth = req.headers.authorization;
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          subjectId: "sub-1",
          workspaceId: "ws-1",
          role: "admin",
        }),
      );
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

    const context = await client.auth.getContext();
    expect(context).toEqual({
      subjectId: "sub-1",
      workspaceId: "ws-1",
      role: "admin",
    });
    expect(capturedAuth).toBe("Bearer test-key");
  });
});
