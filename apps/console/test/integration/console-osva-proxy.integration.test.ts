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
      legacyApiKeyMode: true,
      host: "127.0.0.1",
      port: 0,
      clientDistDir: "/tmp/unused",
      allowedOrigins: [],
    };

    consoleServer = createConsoleServer({ config });
    await new Promise<void>((resolve) => consoleServer!.listen(0, resolve));
    const consoleAddress = consoleServer!.address();
    if (consoleAddress === null || typeof consoleAddress === "string") {
      throw new Error("expected console address");
    }

    const runsResponse = await fetch(
      `http://127.0.0.1:${consoleAddress.port}/api/v1/runs`,
    );
    expect(runsResponse.status).toBe(200);

    expect(capturedAuthorization).toBe("Bearer integration-console-key");
  });

  it("streams artifact metadata and bytes through the real SDK client", async () => {
    const payload = Buffer.alloc(128 * 1024, 0x5a);
    const digest = `sha256:${"d".repeat(64)}`;
    let capturedAuthorization: string | undefined;
    let capturedPath: string | undefined;

    upstream = http.createServer((req, res) => {
      capturedAuthorization = req.headers.authorization;
      capturedPath = req.url;
      if (req.url === "/v1/artifacts/artifact-bin") {
        res.writeHead(200, {
          "Content-Type": "application/json",
          "x-osva-request-id": "req-up-meta",
        });
        res.end(
          JSON.stringify({
            id: "artifact-bin",
            workspaceId: "workspace-int",
            name: "payload.bin",
            mediaType: "application/octet-stream",
            sizeBytes: payload.length,
            digest,
            metadata: {},
            createdAt: "2026-01-01T00:00:00.000Z",
          }),
        );
        return;
      }
      if (req.url === "/v1/artifacts/artifact-bin/content") {
        res.writeHead(200, {
          "Content-Type": "application/octet-stream",
          "Content-Length": String(payload.length),
          "Content-Disposition": 'attachment; filename="payload.bin"',
          "X-Content-Type-Options": "nosniff",
          Digest: digest,
          "x-osva-request-id": "req-up-content",
        });
        res.write(payload.subarray(0, 64 * 1024));
        res.end(payload.subarray(64 * 1024));
        return;
      }
      if (req.url === "/v1/artifacts/foreign") {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "not_found" }));
        return;
      }
      if (req.url === "/v1/artifacts/missing-blob/content") {
        res.writeHead(503, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "unavailable" }));
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
      legacyApiKeyMode: true,
      host: "127.0.0.1",
      port: 0,
      clientDistDir: "/tmp/unused",
      allowedOrigins: [],
    };
    consoleServer = createConsoleServer({ config });
    await new Promise<void>((resolve) => consoleServer!.listen(0, resolve));
    const consoleAddress = consoleServer!.address();
    if (consoleAddress === null || typeof consoleAddress === "string") {
      throw new Error("expected console address");
    }
    const origin = `http://127.0.0.1:${consoleAddress.port}`;

    const metadata = await fetch(`${origin}/api/v1/artifacts/artifact-bin`);
    const metadataBody = await metadata.text();
    expect(metadata.status).toBe(200);
    expect(JSON.parse(metadataBody)).toMatchObject({
      id: "artifact-bin",
      name: "payload.bin",
      sizeBytes: payload.length,
    });
    expect(metadataBody).not.toContain("integration-console-key");
    expect(capturedAuthorization).toBe("Bearer integration-console-key");

    const content = await fetch(
      `${origin}/api/v1/artifacts/artifact-bin/content`,
    );
    expect(content.status).toBe(200);
    expect(content.headers.get("content-disposition")).toContain("attachment");
    expect(content.headers.get("x-content-type-options")).toBe("nosniff");
    expect(content.headers.get("digest")).toBe(digest);
    expect(content.headers.get("authorization")).toBeNull();
    const bytes = Buffer.from(await content.arrayBuffer());
    expect(bytes.equals(payload)).toBe(true);
    expect(capturedPath).toBe("/v1/artifacts/artifact-bin/content");

    const foreign = await fetch(`${origin}/api/v1/artifacts/foreign`);
    expect(foreign.status).toBe(404);
    expect(await foreign.text()).not.toContain("integration-console-key");

    const missingBlob = await fetch(
      `${origin}/api/v1/artifacts/missing-blob/content`,
    );
    expect(missingBlob.status).toBe(503);
    const missingBody = (await missingBlob.json()) as { error?: string };
    expect(missingBody.error).toBe("Requested resource is unavailable.");
    expect(JSON.stringify(missingBody)).not.toContain(".osva/artifacts");
  });
});
