import type {
  McpToolVersionResource,
  ToolResource,
  ToolVersionResource,
} from "../hooks/use-tools-connectors";
import { getExampleById } from "./osva-examples-catalog";
import { RELATED_EXAMPLES_BY_CONNECTOR_ID } from "./osva-connectors-catalog";
import type { AgentToolBindingRow } from "./agent-tool-bindings";
import { suggestBindingNameForRemoteTool } from "./agent-tool-bindings";

export const CONNECTOR_ADOPTION_JOURNEY = [
  {
    id: "catalog",
    label: "Connector catalog",
    description: "Browse published MCP connector profiles.",
  },
  {
    id: "workspace-connector",
    label: "Workspace connector",
    description: "Create a workspace-scoped connector identity and version.",
  },
  {
    id: "discover-import",
    label: "Discover & import",
    description:
      "Discovery lists remote metadata; import registers immutable ToolVersions.",
  },
  {
    id: "agent-binding",
    label: "AgentVersion binding",
    description:
      "Bind ToolVersion ids by logical name on a new immutable AgentVersion.",
  },
  {
    id: "run",
    label: "Authorized Run",
    description:
      "Launch a user-triggered Run; ToolGateway authorizes each tool call.",
  },
  {
    id: "diagnostics",
    label: "Run diagnostics",
    description:
      "Inspect Tool RunSteps and sanitized error codes on Run Detail.",
  },
] as const;

export type ToolCatalogRow = {
  readonly tool: ToolResource;
  readonly versions: readonly ToolVersionResource[];
};

export interface ValidatedToolVersionHandoff {
  readonly toolVersionId: string;
  readonly toolId: string;
  readonly toolKey: string;
  readonly toolName: string;
  readonly version: ToolVersionResource;
}

const HANDOFF_PARAM = "toolVersionIds";
const MAX_HANDOFF_IDS = 32;

export function parseToolVersionHandoffParam(
  value: string | null,
): readonly string[] {
  if (value === null || value.trim().length === 0) {
    return [];
  }
  const parts = value.split(",").flatMap((segment) =>
    segment
      .split(/\s+/)
      .map((id) => id.trim())
      .filter((id) => id.length > 0),
  );
  const unique: string[] = [];
  const seen = new Set<string>();
  for (const id of parts) {
    if (seen.has(id)) {
      continue;
    }
    seen.add(id);
    unique.push(id);
    if (unique.length >= MAX_HANDOFF_IDS) {
      break;
    }
  }
  return unique;
}

export function toolVersionHandoffSearch(ids: readonly string[]): string {
  if (ids.length === 0) {
    return "";
  }
  const params = new URLSearchParams();
  params.set(HANDOFF_PARAM, ids.join(","));
  return `?${params.toString()}`;
}

export function buildAgentPickerHandoffPath(ids: readonly string[]): string {
  return `/agents${toolVersionHandoffSearch(ids)}`;
}

export function buildAgentVersionCreateHandoffPath(
  agentId: string,
  ids: readonly string[],
): string {
  return `/agents/${encodeURIComponent(agentId)}/versions/new${toolVersionHandoffSearch(ids)}`;
}

export function validateToolVersionHandoff(
  hintedIds: readonly string[],
  catalog: readonly ToolCatalogRow[] | undefined,
): {
  readonly validated: readonly ValidatedToolVersionHandoff[];
  readonly rejected: readonly string[];
} {
  if (hintedIds.length === 0) {
    return { validated: [], rejected: [] };
  }
  if (catalog === undefined) {
    return { validated: [], rejected: [...hintedIds] };
  }
  const byVersionId = new Map<string, ValidatedToolVersionHandoff>();
  for (const row of catalog) {
    for (const version of row.versions) {
      byVersionId.set(version.id, {
        toolVersionId: version.id,
        toolId: row.tool.id,
        toolKey: row.tool.key,
        toolName: row.tool.name,
        version,
      });
    }
  }
  const validated: ValidatedToolVersionHandoff[] = [];
  const rejected: string[] = [];
  for (const id of hintedIds) {
    const match = byVersionId.get(id);
    if (match === undefined) {
      rejected.push(id);
    } else {
      validated.push(match);
    }
  }
  return { validated, rejected };
}

export function buildPreselectedBindingRows(
  validated: readonly ValidatedToolVersionHandoff[],
): readonly AgentToolBindingRow[] {
  const usedNames = new Set<string>();
  return validated.map((entry) => {
    const remoteName =
      entry.version.type === "MCP"
        ? entry.version.mcp.remoteToolName
        : entry.toolKey;
    let bindingName = suggestBindingNameForRemoteTool(remoteName);
    let suffix = 2;
    while (usedNames.has(bindingName)) {
      bindingName = `${suggestBindingNameForRemoteTool(remoteName)}_${String(suffix)}`;
      suffix += 1;
    }
    usedNames.add(bindingName);
    return {
      bindingName,
      toolId: entry.toolId,
      toolVersionId: entry.toolVersionId,
    };
  });
}

export function lookupToolVersionInCatalog(
  catalog: readonly ToolCatalogRow[] | undefined,
  toolVersionId: string,
):
  | { readonly tool: ToolResource; readonly version: ToolVersionResource }
  | undefined {
  if (catalog === undefined) {
    return undefined;
  }
  for (const row of catalog) {
    const match = row.versions.find((v) => v.id === toolVersionId);
    if (match !== undefined) {
      return { tool: row.tool, version: match };
    }
  }
  return undefined;
}

export function isMcpToolVersion(
  version: ToolVersionResource,
): version is McpToolVersionResource {
  return version.type === "MCP";
}

export interface ConnectorExampleDocLink {
  readonly exampleId: string;
  readonly title: string;
  readonly consolePath: string;
}

export function relatedExampleDocLinks(
  catalogConnectorId: string,
): readonly ConnectorExampleDocLink[] {
  const ids = RELATED_EXAMPLES_BY_CONNECTOR_ID[catalogConnectorId] ?? [];
  return ids.flatMap((exampleId) => {
    const entry = getExampleById(exampleId);
    if (entry === undefined) {
      return [];
    }
    return [
      {
        exampleId: entry.id,
        title: entry.title,
        consolePath: `/examples/${entry.id}`,
      },
    ];
  });
}

export function describeConnectorJourneyStage(
  stageId: (typeof CONNECTOR_ADOPTION_JOURNEY)[number]["id"],
): string | undefined {
  return CONNECTOR_ADOPTION_JOURNEY.find((stage) => stage.id === stageId)
    ?.description;
}
