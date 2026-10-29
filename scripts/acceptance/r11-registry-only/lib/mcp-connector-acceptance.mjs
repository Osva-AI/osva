import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../..",
);

function authHeaders(apiKey) {
  return {
    authorization: `Bearer ${apiKey}`,
    "content-type": "application/json",
  };
}

async function fetchJson(url, apiKey, init = {}) {
  const response = await fetch(url, {
    ...init,
    headers: {
      ...authHeaders(apiKey),
      ...(init.headers ?? {}),
    },
  });
  const text = await response.text();
  let body;
  try {
    body = text.length > 0 ? JSON.parse(text) : undefined;
  } catch {
    body = text;
  }
  return { status: response.status, body };
}

function dockerHostMcpUrl(hostPort) {
  if (process.platform === "win32" || process.platform === "darwin") {
    return `http://host.docker.internal:${hostPort}`;
  }
  return `http://172.17.0.1:${hostPort}`;
}

export async function ensureFakeMcpBuilt() {
  const dist = path.join(
    REPO_ROOT,
    "adapters",
    "mcp-client",
    "dist",
    "testing",
    "fake-http-mcp-server.js",
  );
  if (fs.existsSync(dist)) {
    return dist;
  }
  const build = spawnSync(
    "pnpm",
    ["exec", "turbo", "run", "build", "--filter=@osva/adapters-mcp-client"],
    { cwd: REPO_ROOT, stdio: "inherit", shell: process.platform === "win32" },
  );
  if (build.status !== 0) {
    throw new Error(
      "Failed to build @osva/adapters-mcp-client for fake MCP fixture.",
    );
  }
  return dist;
}

/**
 * @param {object} ctx
 * @param {string} ctx.baseUrl
 * @param {string} ctx.apiKey
 * @param {string} ctx.workspaceId
 */
export async function runMcpConnectorAcceptance(ctx) {
  const fakeModulePath = await ensureFakeMcpBuilt();
  const fakeModule = await import(pathToFileURL(fakeModulePath).href);
  const fake = await fakeModule.startFakeHttpMcpServer({
    bindHost: "0.0.0.0",
    allowAnyHost: true,
  });
  try {
    const endpointUrl = dockerHostMcpUrl(new URL(fake.endpointUrl).port);
    const connector = await fetchJson(
      `${ctx.baseUrl}/v1/connectors`,
      ctx.apiKey,
      {
        method: "POST",
        body: JSON.stringify({
          key: "r11-fake-mcp",
          name: "R11 Fake MCP",
        }),
      },
    );
    if (connector.status !== 201) {
      throw new Error(
        `connector create ${connector.status}: ${JSON.stringify(connector.body)}`,
      );
    }
    const connectorId = connector.body.id;
    if (connector.body.workspaceId !== ctx.workspaceId) {
      throw new Error("Connector workspaceId mismatch.");
    }

    const version = await fetchJson(
      `${ctx.baseUrl}/v1/connectors/${connectorId}/versions`,
      ctx.apiKey,
      {
        method: "POST",
        body: JSON.stringify({
          kind: "MCP",
          transport: "STREAMABLE_HTTP",
          transportConfig: { endpointUrl },
        }),
      },
    );
    if (version.status !== 201) {
      throw new Error(
        `connector version ${version.status}: ${JSON.stringify(version.body)}`,
      );
    }
    const connectorVersionId = version.body.id;

    const discover = await fetchJson(
      `${ctx.baseUrl}/v1/connectors/${connectorId}/versions/${connectorVersionId}/discover`,
      ctx.apiKey,
      { method: "POST", body: "{}" },
    );
    if (discover.status !== 200) {
      throw new Error(
        `discover ${discover.status}: ${JSON.stringify(discover.body)}`,
      );
    }
    const tools = discover.body.tools ?? [];
    const echo = tools.find((tool) => tool.remoteToolName === "echo");
    if (echo === undefined) {
      throw new Error(
        `Expected remote tool 'echo' in discovery, got ${tools.length} tools.`,
      );
    }

    const imported = await fetchJson(
      `${ctx.baseUrl}/v1/connectors/import-mcp-tools`,
      ctx.apiKey,
      {
        method: "POST",
        body: JSON.stringify({
          connectorVersionId,
          tools: [
            {
              remoteToolName: "echo",
              toolKey: "r11-echo",
              toolName: "R11 Echo",
            },
          ],
        }),
      },
    );
    if (imported.status !== 200) {
      throw new Error(
        `import ${imported.status}: ${JSON.stringify(imported.body)}`,
      );
    }
    const toolVersionId = imported.body.imported?.[0]?.toolVersionId;
    if (typeof toolVersionId !== "string") {
      throw new Error("Missing toolVersionId after import.");
    }

    return {
      connectorId,
      connectorVersionId,
      toolVersionId,
      endpointUrl,
      discoveredToolCount: tools.length,
    };
  } finally {
    await fake.close();
  }
}
