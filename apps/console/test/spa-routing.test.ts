import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import type { ConsoleConfig } from "../src/server/config.js";
import { createConsoleServer } from "../src/server/server.js";

describe("console production SPA routing", () => {
  let server: http.Server | undefined;
  let tempDir: string | undefined;

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
      osvaApiKey: "test-key",
      host: "127.0.0.1",
      port: 0,
      clientDistDir: tempDir,
    };

    server = createConsoleServer({ config, client: undefined });
    await new Promise<void>((resolve) => server!.listen(0, resolve));
    const address = server.address();
    if (address === null || typeof address === "string") {
      throw new Error("expected server address");
    }
    const origin = `http://127.0.0.1:${address.port}`;

    const runDetail = await fetch(`${origin}/runs/run-123`);
    expect(runDetail.status).toBe(200);
    expect(await runDetail.text()).toContain('id="root"');

    const attemptDetail = await fetch(
      `${origin}/runs/run-123/attempts/attempt-456`,
    );
    expect(attemptDetail.status).toBe(200);
    expect(await attemptDetail.text()).toContain('id="root"');

    const asset = await fetch(`${origin}/assets/app.js`);
    expect(asset.status).toBe(200);
    expect(await asset.text()).toContain("console.log");

    const workflowDetail = await fetch(`${origin}/workflows/wf-1`);
    expect(workflowDetail.status).toBe(200);
    expect(await workflowDetail.text()).toContain('id="root"');

    const workflowVersion = await fetch(
      `${origin}/workflows/wf-1/versions/wv-1`,
    );
    expect(workflowVersion.status).toBe(200);

    const workflowRunDetail = await fetch(`${origin}/workflow-runs/wr-1`);
    expect(workflowRunDetail.status).toBe(200);

    const apiRoute = await fetch(`${origin}/api/v1/auth/context`);
    expect(apiRoute.status).toBe(503);
    expect(await apiRoute.text()).not.toContain('id="root"');
  });
});
