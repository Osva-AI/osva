import type { WorkspaceId } from "@osva/contracts";

export interface BearerTokenMapping {
  readonly token: string;
  readonly workspaceId: WorkspaceId;
}

export function parseBearerTokenMappings(
  raw: string,
): ReadonlyMap<string, WorkspaceId> {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    throw new Error("OSVA_MCP_BEARER_TOKENS must not be empty.");
  }

  const mappings = trimmed.startsWith("[")
    ? parseBearerTokenJson(trimmed)
    : parseBearerTokenLegacy(trimmed);

  const map = new Map<string, WorkspaceId>();
  for (const entry of mappings) {
    if (entry.token.length === 0 || entry.workspaceId.length === 0) {
      throw new Error(
        "Bearer token mappings must include non-empty token and workspaceId.",
      );
    }
    if (map.has(entry.token)) {
      throw new Error("Duplicate bearer token in OSVA_MCP_BEARER_TOKENS.");
    }
    map.set(entry.token, entry.workspaceId);
  }

  return map;
}

function parseBearerTokenJson(raw: string): readonly BearerTokenMapping[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("OSVA_MCP_BEARER_TOKENS JSON is malformed.");
  }

  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error("OSVA_MCP_BEARER_TOKENS JSON must be a non-empty array.");
  }

  const mappings: BearerTokenMapping[] = [];
  for (const item of parsed) {
    if (item === null || typeof item !== "object") {
      throw new Error("OSVA_MCP_BEARER_TOKENS JSON entries must be objects.");
    }
    const record = item as Record<string, unknown>;
    if (
      typeof record.token !== "string" ||
      typeof record.workspaceId !== "string"
    ) {
      throw new Error(
        "OSVA_MCP_BEARER_TOKENS JSON entries require string token and workspaceId.",
      );
    }
    mappings.push({
      token: record.token.trim(),
      workspaceId: record.workspaceId.trim() as WorkspaceId,
    });
  }

  return mappings;
}

function parseBearerTokenLegacy(raw: string): readonly BearerTokenMapping[] {
  const entries = raw
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  if (entries.length === 0) {
    throw new Error("OSVA_MCP_BEARER_TOKENS must include at least one entry.");
  }

  const mappings: BearerTokenMapping[] = [];
  for (const entry of entries) {
    const separator = entry.indexOf(":");
    if (separator <= 0 || separator === entry.length - 1) {
      throw new Error(
        "Legacy OSVA_MCP_BEARER_TOKENS entries must use '<token>:<workspaceId>' format. Use JSON for tokens containing ':'.",
      );
    }

    mappings.push({
      token: entry.slice(0, separator).trim(),
      workspaceId: entry.slice(separator + 1).trim() as WorkspaceId,
    });
  }

  return mappings;
}
