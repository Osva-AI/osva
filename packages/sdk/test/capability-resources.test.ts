import http from "node:http";
import { afterEach, describe, expect, it } from "vitest";

import { OsvaClient } from "../src/client.js";
import { OsvaApiError, OsvaTransportError } from "../src/errors.js";

const TEST_API_KEY = "osva_ak_test.secret";

const SAMPLE_MODEL_PROFILE = {
  id: "mp-1",
  workspaceId: "ws-1",
  key: "primary",
  name: "Primary",
  createdAt: "2026-01-01T00:00:00.000Z",
};

const SAMPLE_MODEL_PROFILE_VERSION = {
  id: "mpv-1",
  modelProfileId: "mp-1",
  version: 1,
  provider: "OPENAI",
  model: "gpt-4o-mini",
  createdAt: "2026-01-01T00:00:00.000Z",
};

const SAMPLE_CONNECTOR = {
  id: "conn-1",
  workspaceId: "ws-1",
  key: "npm",
  name: "NPM",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const SAMPLE_CONNECTOR_VERSION = {
  id: "cv-1",
  connectorId: "conn-1",
  version: 1,
  kind: "MCP",
  transport: "STREAMABLE_HTTP",
  transportConfig: { endpointUrl: "http://127.0.0.1:9999/mcp" },
  createdAt: "2026-01-01T00:00:00.000Z",
};

const SAMPLE_MCP_TOOL_VERSION = {
  id: "tv-1",
  toolId: "tool-1",
  version: 1,
  type: "MCP",
  implementation: "MCP_V1",
  mcp: {
    connectorVersionId: "cv-1",
    remoteToolName: "npm_package_metadata",
  },
  createdAt: "2026-01-01T00:00:00.000Z",
};

const servers: http.Server[] = [];

describe("OsvaClient capability resources", () => {
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

  it("routes model profile lifecycle requests", async () => {
    const calls: Array<{ method?: string; path?: string; body?: unknown }> = [];
    const server = await startServer((req, res, body) => {
      calls.push({ method: req.method, path: req.url ?? "", body });
      if (req.method === "GET" && req.url === "/v1/model-profiles") {
        writeJson(res, 200, { modelProfiles: [SAMPLE_MODEL_PROFILE] });
        return;
      }
      if (req.method === "POST" && req.url === "/v1/model-profiles") {
        writeJson(res, 201, SAMPLE_MODEL_PROFILE);
        return;
      }
      if (
        req.method === "GET" &&
        req.url === "/v1/model-profiles/mp-1/versions"
      ) {
        writeJson(res, 200, { versions: [SAMPLE_MODEL_PROFILE_VERSION] });
        return;
      }
      if (
        req.method === "POST" &&
        req.url === "/v1/model-profiles/mp-1/versions"
      ) {
        writeJson(res, 201, SAMPLE_MODEL_PROFILE_VERSION);
        return;
      }
      if (
        req.method === "GET" &&
        req.url === "/v1/model-profiles/mp-1/versions/mpv-1"
      ) {
        writeJson(res, 200, SAMPLE_MODEL_PROFILE_VERSION);
        return;
      }
      res.writeHead(404);
      res.end();
    });

    const client = new OsvaClient({
      baseUrl: server.origin,
      apiKey: TEST_API_KEY,
    });

    const listed = await client.modelProfiles.list();
    expect(listed.modelProfiles).toHaveLength(1);

    const created = await client.modelProfiles.create({
      key: "primary",
      name: "Primary",
    });
    expect(created.id).toBe("mp-1");

    const versions = await client.modelProfiles.listVersions("mp-1" as never);
    expect(versions.versions[0]?.id).toBe("mpv-1");

    const version = await client.modelProfiles.createVersion("mp-1" as never, {
      provider: "OPENAI",
      model: "gpt-4o-mini",
    });
    expect(version.model).toBe("gpt-4o-mini");

    const loaded = await client.modelProfiles.getVersion(
      "mp-1" as never,
      "mpv-1" as never,
    );
    expect(loaded.provider).toBe("OPENAI");

    expect(calls.some((c) => c.path === "/v1/model-profiles")).toBe(true);
    expect(
      calls.some(
        (c) =>
          c.method === "POST" &&
          c.path === "/v1/model-profiles/mp-1/versions" &&
          c.body !== undefined,
      ),
    ).toBe(true);
  });

  it("routes connector discover and import requests", async () => {
    let discoverBody: unknown;
    let importBody: unknown;
    const server = await startServer((req, res, body) => {
      if (req.method === "GET" && req.url === "/v1/connectors") {
        writeJson(res, 200, { connectors: [SAMPLE_CONNECTOR] });
        return;
      }
      if (req.method === "POST" && req.url === "/v1/connectors") {
        writeJson(res, 201, SAMPLE_CONNECTOR);
        return;
      }
      if (
        req.method === "POST" &&
        req.url === "/v1/connectors/conn-1/versions/cv-1/discover"
      ) {
        discoverBody = body;
        writeJson(res, 200, {
          connectorVersionId: "cv-1",
          tools: [
            {
              remoteToolName: "npm_package_metadata",
              inputSchema: { type: "object" },
            },
          ],
        });
        return;
      }
      if (
        req.method === "POST" &&
        req.url === "/v1/connectors/import-mcp-tools"
      ) {
        importBody = body;
        writeJson(res, 200, {
          imported: [
            {
              toolId: "tool-1",
              toolVersionId: "tv-1",
              remoteToolName: "npm_package_metadata",
              toolKey: "npm_package_metadata",
              createdNewToolVersion: true,
            },
          ],
        });
        return;
      }
      if (
        req.method === "GET" &&
        req.url === "/v1/connectors/conn-1/versions/cv-1"
      ) {
        writeJson(res, 200, SAMPLE_CONNECTOR_VERSION);
        return;
      }
      res.writeHead(404);
      res.end();
    });

    const client = new OsvaClient({
      baseUrl: server.origin,
      apiKey: TEST_API_KEY,
    });

    await client.connectors.list();
    await client.connectors.create({ key: "npm", name: "NPM" });

    const discovered = await client.connectors.discover(
      "conn-1" as never,
      "cv-1" as never,
    );
    expect(discovered.tools).toHaveLength(1);
    expect(discoverBody).toEqual({});

    const imported = await client.connectors.importMcpTools({
      connectorVersionId: "cv-1" as never,
      tools: [
        {
          remoteToolName: "npm_package_metadata",
          toolKey: "npm_package_metadata",
          toolName: "NPM package metadata",
        },
      ],
    });
    expect(imported.imported[0]?.toolVersionId).toBe("tv-1");
    expect(importBody).toMatchObject({
      connectorVersionId: "cv-1",
      tools: [
        {
          remoteToolName: "npm_package_metadata",
          toolKey: "npm_package_metadata",
          toolName: "NPM package metadata",
        },
      ],
    });

    const version = await client.connectors.getVersion(
      "conn-1" as never,
      "cv-1" as never,
    );
    expect(version.transport).toBe("STREAMABLE_HTTP");
    expect(version.transportConfig).toEqual({
      endpointUrl: "http://127.0.0.1:9999/mcp",
    });
    expect(JSON.stringify(version)).not.toMatch(/secret|apiKey|password/i);
  });

  it("loads imported MCP tool versions", async () => {
    const server = await startServer((req, res) => {
      if (req.method === "GET" && req.url === "/v1/tools/tool-1") {
        writeJson(res, 200, {
          id: "tool-1",
          workspaceId: "ws-1",
          key: "npm_package_metadata",
          name: "NPM package metadata",
          createdAt: "2026-01-01T00:00:00.000Z",
        });
        return;
      }
      if (
        req.method === "GET" &&
        req.url === "/v1/tools/tool-1/versions/tv-1"
      ) {
        writeJson(res, 200, SAMPLE_MCP_TOOL_VERSION);
        return;
      }
      res.writeHead(404);
      res.end();
    });

    const client = new OsvaClient({
      baseUrl: server.origin,
      apiKey: TEST_API_KEY,
    });

    const tool = await client.tools.get("tool-1" as never);
    expect(tool.key).toBe("npm_package_metadata");

    const version = await client.tools.getVersion(
      "tool-1" as never,
      "tv-1" as never,
    );
    expect(version.type).toBe("MCP");
    if (version.type === "MCP") {
      expect(version.mcp.remoteToolName).toBe("npm_package_metadata");
    }
  });

  it("maps non-JSON responses to OsvaTransportError", async () => {
    const server = await startServer((_req, res) => {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("not json");
    });

    const client = new OsvaClient({
      baseUrl: server.origin,
      apiKey: TEST_API_KEY,
    });

    await expect(client.modelProfiles.list()).rejects.toBeInstanceOf(
      OsvaTransportError,
    );
  });

  it("maps authorization failures to OsvaApiError for capability routes", async () => {
    const server = await startServer((_req, res) => {
      writeJson(res, 403, {
        status: "error",
        code: "FORBIDDEN",
        message: "Insufficient role for this operation.",
      });
    });

    const client = new OsvaClient({
      baseUrl: server.origin,
      apiKey: TEST_API_KEY,
    });

    await expect(
      client.modelProfiles.create({ key: "x", name: "X" }),
    ).rejects.toBeInstanceOf(OsvaApiError);
    await expect(
      client.connectors.discover("conn-1" as never, "cv-1" as never),
    ).rejects.toMatchObject({ status: 403 });
  });
});

async function startServer(
  handler: (
    req: http.IncomingMessage,
    res: http.ServerResponse,
    body: unknown,
  ) => void,
): Promise<{ origin: string }> {
  const server = http.createServer((req, res) => {
    void (async () => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      const raw = Buffer.concat(chunks).toString("utf8").trim();
      const body = raw.length === 0 ? undefined : JSON.parse(raw);
      handler(req, res, body);
    })().catch(() => {
      res.writeHead(500);
      res.end();
    });
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
    throw new Error("Failed to bind test server.");
  }

  servers.push(server);
  return { origin: `http://127.0.0.1:${String(address.port)}` };
}

function writeJson(
  res: http.ServerResponse,
  status: number,
  body: unknown,
): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}
