import http from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";

import { runCommand } from "../src/commands/index.js";
import { loadCliConfig, parseCliArgs } from "../src/config.js";
import { OsvaClient } from "@osva/sdk";

describe("CLI", () => {
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

  it("prints help without requiring config", async () => {
    const stdout = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);
    const code = await runCommand(
      new OsvaClient({
        baseUrl: "http://127.0.0.1:9",
        workspaceId: "ws" as never,
      }),
      {
        baseUrl: "http://127.0.0.1:9",
        workspaceId: "ws" as never,
        json: false,
      },
      ["help"],
      {},
    );
    expect(code).toBe(0);
    expect(stdout.mock.calls.join("")).toContain("agents list");
    stdout.mockRestore();
  });

  it("loads environment configuration with flag precedence", () => {
    const config = loadCliConfig(
      { "base-url": "http://flag", "workspace-id": "ws-flag" },
      {
        OSVA_BASE_URL: "http://env",
        OSVA_WORKSPACE_ID: "ws-env",
      },
    );
    expect(config.baseUrl).toBe("http://flag");
    expect(config.workspaceId).toBe("ws-flag");
  });

  it("validates missing configuration", () => {
    expect(() => loadCliConfig({}, {})).toThrow("Missing required --base-url");
  });

  it("runs a representative read command through the SDK client", async () => {
    const server = await startMockServer((_req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ agents: [{ id: "agent-1", name: "A" }] }));
    });
    const client = new OsvaClient({
      baseUrl: server.origin,
      workspaceId: "ws-1" as never,
    });
    const stdout = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);
    const code = await runCommand(
      client,
      { baseUrl: server.origin, workspaceId: "ws-1" as never, json: true },
      ["agents", "list"],
      {},
    );
    expect(code).toBe(0);
    expect(stdout.mock.calls[0]?.[0]).toContain("agent-1");
    stdout.mockRestore();
  });

  it("returns non-zero on API failure", async () => {
    const server = await startMockServer((_req, res) => {
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ status: "not_found" }));
    });
    const client = new OsvaClient({
      baseUrl: server.origin,
      workspaceId: "ws-1" as never,
    });
    const stderr = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
    const code = await runCommand(
      client,
      { baseUrl: server.origin, workspaceId: "ws-1" as never, json: false },
      ["agents", "get", "missing"],
      {},
    );
    expect(code).toBe(1);
    stderr.mockRestore();
  });

  it("parses global flags before commands", () => {
    const parsed = parseCliArgs([
      "--json",
      "--base-url",
      "http://127.0.0.1:3000",
      "agents",
      "list",
    ]);
    expect(parsed.flags.json).toBe(true);
    expect(parsed.flags["base-url"]).toBe("http://127.0.0.1:3000");
    expect(parsed.command).toEqual(["agents", "list"]);
  });
});

async function startMockServer(
  handler: (req: http.IncomingMessage, res: http.ServerResponse) => void,
): Promise<{ origin: string }> {
  const server = http.createServer((req, res) => {
    handler(req, res);
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
  return { origin: `http://127.0.0.1:${String(address.port)}` };
}
