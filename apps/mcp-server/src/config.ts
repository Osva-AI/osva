import type { WorkspaceId } from "@osva/contracts";

import { parseBearerTokenMappings } from "./bearer-tokens.js";

export interface McpServerConfig {
  readonly host: string;
  readonly port: number;
  readonly osvaApiBaseUrl: string;
  readonly mcpPath: string;
  readonly bearerTokens: ReadonlyMap<string, WorkspaceId>;
}

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 3100;
const DEFAULT_MCP_PATH = "/mcp";

export function loadMcpServerConfig(
  env: NodeJS.ProcessEnv = process.env,
): McpServerConfig {
  const host = readOptional(env.OSVA_MCP_HOST) ?? DEFAULT_HOST;
  const port = parsePort(env.OSVA_MCP_PORT, DEFAULT_PORT);
  const osvaApiBaseUrl = readRequired(
    env.OSVA_API_BASE_URL,
    "OSVA_API_BASE_URL",
  );
  const mcpPath = normalizePath(
    readOptional(env.OSVA_MCP_PATH) ?? DEFAULT_MCP_PATH,
  );
  const bearerTokens = parseBearerTokenMappings(
    readRequired(env.OSVA_MCP_BEARER_TOKENS, "OSVA_MCP_BEARER_TOKENS"),
  );

  return {
    host,
    port,
    osvaApiBaseUrl,
    mcpPath,
    bearerTokens,
  };
}

function normalizePath(path: string): string {
  if (!path.startsWith("/")) {
    return `/${path}`;
  }
  return path.replace(/\/+$/, "") || "/mcp";
}

function readRequired(value: string | undefined, name: string): string {
  const trimmed = value?.trim() ?? "";
  if (trimmed.length === 0) {
    throw new Error(`${name} is required.`);
  }
  return trimmed;
}

function readOptional(value: string | undefined): string | undefined {
  const trimmed = value?.trim() ?? "";
  return trimmed.length === 0 ? undefined : trimmed;
}

function parsePort(value: string | undefined, fallback: number): number {
  const trimmed = value?.trim() ?? "";
  if (trimmed.length === 0) {
    return fallback;
  }

  if (!/^\d+$/.test(trimmed)) {
    throw new Error("OSVA_MCP_PORT must be an integer between 0 and 65535.");
  }

  const port = Number.parseInt(trimmed, 10);
  if (port < 0 || port > 65535) {
    throw new Error("OSVA_MCP_PORT must be an integer between 0 and 65535.");
  }

  return port;
}
