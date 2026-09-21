import http from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";

import { runCommand } from "../src/commands/index.js";
import { loadCliConfig, parseCliArgs } from "../src/config.js";
import { OsvaClient } from "@osva/sdk";

const TEST_API_KEY = "osva_ak_test.secret";

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
        apiKey: TEST_API_KEY,
      }),
      {
        baseUrl: "http://127.0.0.1:9",
        apiKey: TEST_API_KEY,
        json: false,
      },
      ["help"],
      {},
    );
    expect(code).toBe(0);
    expect(stdout.mock.calls.join("")).toContain("agents list");
    stdout.mockRestore();
  });

  it("loads environment configuration with base-url flag precedence", () => {
    const config = loadCliConfig(
      { "base-url": "http://flag" },
      {
        OSVA_BASE_URL: "http://env",
        OSVA_API_KEY: "osva_ak_env.secret",
      },
    );
    expect(config.baseUrl).toBe("http://flag");
    expect(config.apiKey).toBe("osva_ak_env.secret");
  });

  it("rejects --api-key flag", () => {
    expect(() =>
      loadCliConfig(
        { "api-key": "osva_ak_flag.secret" },
        { OSVA_BASE_URL: "http://env", OSVA_API_KEY: "osva_ak_env.secret" },
      ),
    ).toThrow("--api-key flag is not supported");
  });

  it("validates missing configuration", () => {
    expect(() => loadCliConfig({}, {})).toThrow("Missing required --base-url");
  });

  it("runs a representative read command through the SDK client", async () => {
    const server = await startMockServer(servers, (_req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ agents: [{ id: "agent-1", name: "A" }] }));
    });
    const client = new OsvaClient({
      baseUrl: server.origin,
      apiKey: TEST_API_KEY,
    });
    const stdout = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);
    const code = await runCommand(
      client,
      { baseUrl: server.origin, apiKey: TEST_API_KEY, json: true },
      ["agents", "list"],
      {},
    );
    expect(code).toBe(0);
    expect(stdout.mock.calls[0]?.[0]).toContain("agent-1");
    stdout.mockRestore();
  });

  it("returns non-zero on API failure", async () => {
    const server = await startMockServer(servers, (_req, res) => {
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ status: "not_found" }));
    });
    const client = new OsvaClient({
      baseUrl: server.origin,
      apiKey: TEST_API_KEY,
    });
    const stderr = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
    const code = await runCommand(
      client,
      { baseUrl: server.origin, apiKey: TEST_API_KEY, json: false },
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
  servers: http.Server[],
  handler: (req: http.IncomingMessage, res: http.ServerResponse) => void,
): Promise<{ origin: string; server: http.Server }> {
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
  servers.push(server);
  return { origin: `http://127.0.0.1:${String(address.port)}`, server };
}
