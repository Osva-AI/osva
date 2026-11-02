import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import type { ConsoleConfig } from "../src/server/config.js";
import type { ConsoleOsvaClient } from "../src/server/osva-client.js";
import { createConsoleServer } from "../src/server/server.js";

const REQUEST_TIMEOUT_MS = 5_000;

async function fetchWithTimeout(url: string, label: string): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { signal: controller.signal });
  } catch (error) {
    const detail =
      error instanceof Error ? error.message : "unknown fetch error";
    throw new Error(
      `SPA routing fetch timed out or failed (${label}, ${REQUEST_TIMEOUT_MS}ms): ${url} — ${detail}`,
    );
  } finally {
    clearTimeout(timer);
  }
}

async function closeHttpServer(server: http.Server): Promise<void> {
  server.closeAllConnections?.();
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

describe("console production SPA routing", () => {
  let server: http.Server | undefined;
  let tempDir: string | undefined;

  afterEach(async () => {
    if (server !== undefined) {
      await closeHttpServer(server);
      server = undefined;
    }
    if (tempDir !== undefined) {
      await rm(tempDir, { recursive: true, force: true });
      tempDir = undefined;
    }
  });

  it("serves SPA shell for deep links and keeps API routes separate", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "osva-console-spa-"));
    await mkdir(path.join(tempDir, "assets"), { recursive: true });
    await writeFile(
      path.join(tempDir, "index.html"),
      '<!doctype html><html><body><div id="root"></div></body></html>',
      "utf8",
    );
    await writeFile(
      path.join(tempDir, "assets", "app.js"),
      "console.log('ok');",
      "utf8",
    );

    const config: ConsoleConfig = {
      osvaBaseUrl: "http://127.0.0.1:3000",
      legacyApiKeyMode: false,
      host: "127.0.0.1",
      port: 0,
      clientDistDir: tempDir,
      allowedOrigins: [],
      browserOrigin: "http://127.0.0.1:4174",
    };

    const testClient = {
      listAgents: async () => ({
        data: { agents: [] },
        requestId: "spa-routing-test",
      }),
    } as unknown as ConsoleOsvaClient;

    server = createConsoleServer({ config, client: testClient });
    await new Promise<void>((resolve) => server!.listen(0, resolve));
    const address = server.address();
    if (address === null || typeof address === "string") {
      throw new Error("expected server address");
    }
    const origin = `http://127.0.0.1:${address.port}`;

    const spaPaths = [
      "/agents",
      "/agents/agent-1/versions/av-1",
      "/onboarding",
      "/overview",
      "/examples",
      "/examples/04-seo-worker",
      "/runs/run-123",
      "/runs/run-123/attempts/attempt-456",
      "/workflows/wf-1",
      "/workflows/wf-1/versions/wv-1",
      "/workflow-runs/wr-1",
    ] as const;

    for (const spaPath of spaPaths) {
      const response = await fetchWithTimeout(`${origin}${spaPath}`, spaPath);
      expect(response.status, spaPath).toBe(200);
      expect(await response.text(), spaPath).toContain('id="root"');
    }

    const asset = await fetchWithTimeout(`${origin}/assets/app.js`, "asset");
    expect(asset.status).toBe(200);
    expect(await asset.text()).toContain("console.log");

    const apiRoute = await fetchWithTimeout(
      `${origin}/api/v1/agents`,
      "api-agents-json",
    );
    expect(apiRoute.status).toBe(200);
    expect(apiRoute.headers.get("content-type") ?? "").toContain(
      "application/json",
    );
    expect(await apiRoute.text()).not.toContain('id="root"');
  }, 30_000);
});
