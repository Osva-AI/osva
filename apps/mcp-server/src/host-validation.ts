import type { IncomingMessage, ServerResponse } from "node:http";

import {
  hostHeaderValidation,
  localhostHostValidation,
} from "@modelcontextprotocol/node";

export type McpHostHeaderValidator = (
  request: IncomingMessage,
  response: ServerResponse,
) => boolean;

const LOCALHOST_HOSTNAMES = Object.freeze(["localhost", "127.0.0.1", "[::1]"]);

export function parseMcpAllowedHosts(
  raw: string | undefined,
): readonly string[] {
  const trimmed = raw?.trim() ?? "";
  if (trimmed.length === 0) {
    return [];
  }

  const hosts: string[] = [];
  for (const segment of trimmed.split(",")) {
    const host = normalizeAllowedHost(segment);
    if (host.length === 0) {
      continue;
    }
    if (host === "*" || host.includes("*")) {
      throw new Error(
        "OSVA_MCP_ALLOWED_HOSTS must not contain wildcards; list explicit hostnames.",
      );
    }
    if (!hosts.includes(host)) {
      hosts.push(host);
    }
  }

  return hosts;
}

export function createMcpHostHeaderValidator(
  allowedHosts: readonly string[],
): McpHostHeaderValidator {
  if (allowedHosts.length === 0) {
    return localhostHostValidation();
  }

  const merged = [...LOCALHOST_HOSTNAMES];
  for (const host of allowedHosts) {
    if (!merged.includes(host)) {
      merged.push(host);
    }
  }

  return hostHeaderValidation(merged);
}

function normalizeAllowedHost(segment: string): string {
  const trimmed = segment.trim();
  if (trimmed.length === 0) {
    return "";
  }

  if (trimmed.startsWith("[")) {
    const closing = trimmed.indexOf("]");
    if (closing > 0) {
      return trimmed.slice(0, closing + 1);
    }
  }

  const withoutPort = trimmed.split(":")[0]?.trim() ?? "";
  return withoutPort;
}
