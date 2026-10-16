import http from "node:http";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  removeTempDir,
  runCliSubprocess,
} from "./helpers/run-cli-subprocess.js";

const TEST_API_KEY = "osva_ak_test.secretvalue";

describe("osva bin entrypoint", () => {
  const servers: http.Server[] = [];

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

  it("prints help without credentials", async () => {
    const result = await runCliSubprocess(["help"]);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("doctor");
    expect(result.stdout).toContain("init");
    expect(result.stdout).toContain("validate");
    expect(result.stdout).toContain("deploy");
    expect(result.stdout).toContain("run");
    expect(result.stderr).toBe("");
  });

  it("runs init without credentials", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "osva-bin-init-"));
    try {
      const result = await runCliSubprocess(["init", "cli-smoke-agent"], {
        cwd,
        env: {
          OSVA_API_KEY: "",
          OSVA_BASE_URL: "",
        },
      });
      expect(result.code).toBe(0);
      expect(result.stdout).toContain("Created OSVA agent project");
      expect(result.stdout).not.toMatch(/osva_ak_/);
      expect(result.stderr).toBe("");
    } finally {
      await removeTempDir(cwd);
    }
  });

  it("prints version without credentials", async () => {
    const result = await runCliSubprocess(["version"]);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("version");
    expect(result.stderr).toBe("");
  });

  it("runs doctor without credentials", async () => {
    const result = await runCliSubprocess(["doctor"]);
    expect(result.code).toBe(1);
    expect(result.stdout).toContain("OSVA Doctor");
    expect(result.stdout).not.toMatch(/osva_ak_/);
    expect(result.stderr).toBe("");
  });

  it("emits doctor JSON on stdout with exit code 1 when unconfigured", async () => {
    const result = await runCliSubprocess(["doctor", "--json"]);
    expect(result.code).toBe(1);
    expect(result.stderr).toBe("");
    expect(result.stdout.endsWith("\n")).toBe(true);
    expect(result.stdout.trimStart().startsWith("{")).toBe(true);
    const payload = JSON.parse(result.stdout) as {
      result: string;
      checks: unknown[];
    };
    expect(payload.result).toBe("fail");
    expect(payload.checks.length).toBeGreaterThan(0);
  });

  it("exits cleanly after doctor --json with successful HTTP probes", async () => {
    const server = await startMockControlPlane(servers);
    const result = await runCliSubprocess(["doctor", "--json"], {
      env: {
        OSVA_BASE_URL: server.origin,
        OSVA_API_KEY: TEST_API_KEY,
      },
    });
    expect(result.stderr).not.toContain("Assertion failed");
    expect(result.stderr).not.toContain("UV_HANDLE_CLOSING");
    expect(result.stderr).toBe("");
    expect(result.code).toBe(0);
    expect(result.stdout.endsWith("\n")).toBe(true);
    const payload = JSON.parse(result.stdout) as {
      result: string;
      checks: Array<{ id: string; status: string }>;
    };
    expect(payload.result).toBe("pass");
    expect(payload.checks).toHaveLength(8);
    expect(
      payload.checks.find((check) => check.id === "authentication")?.status,
    ).toBe("PASS");
  });
});

async function startMockControlPlane(servers: http.Server[]): Promise<{
  origin: string;
}> {
  const server = http.createServer((req, res) => {
    if (req.url === "/health") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ status: "ok" }));
      return;
    }
    if (req.url === "/ready") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ status: "ready" }));
      return;
    }
    if (req.url === "/v1/auth/context") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          subjectId: "sub-1",
          workspaceId: "ws-1",
          role: "ADMIN",
        }),
      );
      return;
    }
    res.writeHead(404).end();
  });
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
  servers.push(server);
  return { origin: `http://127.0.0.1:${String(address.port)}` };
}
