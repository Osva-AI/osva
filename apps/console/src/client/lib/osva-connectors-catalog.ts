import catalogSnapshot from "../data/osva-connectors-catalog.snapshot.json";
import {
  buildConnectorInstallGuideUrl,
  buildConnectorNpmPackageUrl,
  buildConnectorPackageReadmeUrl,
  isAllowedOsvaConnectorsUrl,
  OSVA_CONNECTORS_AUDITED_SHA,
  OSVA_CONNECTORS_REPO,
} from "./osva-connectors-links";

export type ConnectorCatalogTransport = "stdio" | "streamable_http";

export type ConnectorCapabilityCategory = "read-only" | "mutations" | "mixed";

export type ConnectorCatalogToolRisk =
  "read-only" | "mutation-capable" | "mixed";

export interface ConnectorCatalogAuthentication {
  readonly method: string;
  readonly requiredCredentialEnv: readonly string[];
}

export interface ConnectorCatalogTools {
  readonly count: number;
  readonly readOnly: readonly string[];
  readonly mutationCapable: readonly string[];
}

export interface ConnectorCatalogEntry {
  readonly connectorId: string;
  readonly connectorKey: string;
  readonly npmPackage: string;
  readonly displayName: string;
  readonly shortTitle: string;
  readonly capabilitySummary: string;
  readonly provider: string;
  readonly publishedVersion: string;
  readonly npmPublishStatus: string;
  readonly sdkVersion: string;
  readonly mcpTransport: ConnectorCatalogTransport;
  readonly authentication: ConnectorCatalogAuthentication;
  readonly tools: ConnectorCatalogTools;
  readonly toolRisk: ConnectorCatalogToolRisk;
  readonly capabilityCategory: ConnectorCapabilityCategory;
  readonly installGuideUrl: string;
  readonly packageReadmeUrl: string;
  readonly npmPackageUrl: string;
  readonly relatedExampleIds: readonly string[];
  readonly mutationClassificationHeuristic: boolean;
}

export interface ConnectorCatalogProvenance {
  readonly repository: typeof OSVA_CONNECTORS_REPO;
  readonly auditedCommitSha: typeof OSVA_CONNECTORS_AUDITED_SHA;
  readonly schemaVersion: number;
  readonly generatedAt: string;
  readonly connectorCount: number;
  readonly sdkPin: string;
  readonly refreshProcedure: string;
}

export const RELATED_EXAMPLES_BY_CONNECTOR_ID: Readonly<
  Record<string, readonly string[]>
> = {
  npm: ["19-research-report-agent"],
  github: ["20-github-repository-analyst"],
  shopify: ["21-commerce-growth-analyst"],
  ga4: ["21-commerce-growth-analyst"],
};

export const CONNECTOR_CATALOG_PROVENANCE: ConnectorCatalogProvenance = {
  repository: OSVA_CONNECTORS_REPO,
  auditedCommitSha: OSVA_CONNECTORS_AUDITED_SHA,
  schemaVersion: catalogSnapshot.schemaVersion,
  generatedAt: catalogSnapshot.generatedAt,
  connectorCount: catalogSnapshot.connectorCount,
  sdkPin: catalogSnapshot.sdkPin,
  refreshProcedure:
    "Replace apps/console/src/client/data/osva-connectors-catalog.snapshot.json from osva-connectors docs/connector-catalog.json at the audited commit; update OSVA_CONNECTORS_AUDITED_SHA in osva-connectors-links.ts.",
};

const DISPLAY_NAME_PREFIX = /^OSVA Connector Profile V1\s+/i;

export function shortenConnectorDisplayName(displayName: string): string {
  const stripped = displayName.replace(DISPLAY_NAME_PREFIX, "").trim();
  const paren = stripped.match(/^(.+?)\s+MCP connector\s*(?:\((.+)\))?$/i);
  if (paren !== null) {
    const base = paren[1]?.trim() ?? stripped;
    const detail = paren[2]?.trim();
    return detail !== undefined && detail.length > 0
      ? `${base} (${detail})`
      : base;
  }
  return stripped;
}

export function deriveCapabilitySummary(displayName: string): string {
  const match = displayName.match(/\(([^)]+)\)\s*$/);
  if (match?.[1] !== undefined && match[1].length > 0) {
    return match[1];
  }
  return "Published MCP connector package";
}

function normalizeTransport(value: string): ConnectorCatalogTransport {
  const lowered = value.toLowerCase();
  if (lowered === "stdio") {
    return "stdio";
  }
  if (
    lowered === "streamable_http" ||
    lowered === "http" ||
    lowered === "streamable-http"
  ) {
    return "streamable_http";
  }
  return "stdio";
}

function deriveToolRisk(
  tools: ConnectorCatalogTools,
): ConnectorCatalogToolRisk {
  const hasRead = tools.readOnly.length > 0;
  const hasMut = tools.mutationCapable.length > 0;
  if (hasRead && hasMut) {
    return "mixed";
  }
  if (hasMut) {
    return "mutation-capable";
  }
  return "read-only";
}

function deriveCapabilityCategory(
  tools: ConnectorCatalogTools,
): ConnectorCapabilityCategory {
  if (tools.mutationCapable.length === 0) {
    return "read-only";
  }
  if (tools.readOnly.length === 0) {
    return "mutations";
  }
  return "mixed";
}

function mapRawConnector(
  raw: (typeof catalogSnapshot.connectors)[number],
): ConnectorCatalogEntry {
  const tools: ConnectorCatalogTools = {
    count: raw.tools.count,
    readOnly: [...raw.tools.readOnly],
    mutationCapable: [...raw.tools.mutationCapable],
  };
  const installGuideUrl = buildConnectorInstallGuideUrl(raw.installGuide);
  const packageReadmeUrl = buildConnectorPackageReadmeUrl(raw.packageReadme);
  const npmPackageUrl = buildConnectorNpmPackageUrl(
    raw.npmPackage,
    raw.publishedVersion,
  );
  return {
    connectorId: raw.connectorId,
    connectorKey: raw.connectorKey,
    npmPackage: raw.npmPackage,
    displayName: raw.displayName,
    shortTitle: shortenConnectorDisplayName(raw.displayName),
    capabilitySummary: deriveCapabilitySummary(raw.displayName),
    provider: raw.provider,
    publishedVersion: raw.publishedVersion,
    npmPublishStatus: raw.npmPublishStatus,
    sdkVersion: raw.sdkVersion,
    mcpTransport: normalizeTransport(raw.mcpTransport),
    authentication: {
      method: raw.authentication.method,
      requiredCredentialEnv: [...raw.authentication.requiredCredentialEnv],
    },
    tools,
    toolRisk: deriveToolRisk(tools),
    capabilityCategory: deriveCapabilityCategory(tools),
    installGuideUrl,
    packageReadmeUrl,
    npmPackageUrl,
    relatedExampleIds: RELATED_EXAMPLES_BY_CONNECTOR_ID[raw.connectorId] ?? [],
    mutationClassificationHeuristic: true,
  };
}

export const CONNECTOR_CATALOG: readonly ConnectorCatalogEntry[] =
  catalogSnapshot.connectors.map(mapRawConnector);

const catalogByConnectorId = new Map(
  CONNECTOR_CATALOG.map((entry) => [entry.connectorId, entry]),
);

export function getConnectorCatalogEntry(
  connectorId: string,
): ConnectorCatalogEntry | undefined {
  return catalogByConnectorId.get(connectorId);
}

export const CONNECTOR_CAPABILITY_CATEGORIES: readonly {
  readonly id: ConnectorCapabilityCategory | "all";
  readonly label: string;
}[] = [
  { id: "all", label: "All capabilities" },
  { id: "read-only", label: "Read-only tools" },
  { id: "mixed", label: "Read + gated mutations" },
  { id: "mutations", label: "Mutation-focused" },
];

export const CONNECTOR_TRANSPORT_FILTERS: readonly {
  readonly id: ConnectorCatalogTransport | "all";
  readonly label: string;
}[] = [
  { id: "all", label: "All transports" },
  { id: "stdio", label: "STDIO (operator-gated)" },
  { id: "streamable_http", label: "Streamable HTTP" },
];

export interface ConnectorCatalogFilterParams {
  readonly query: string;
  readonly capability: ConnectorCapabilityCategory | "all";
  readonly transport: ConnectorCatalogTransport | "all";
}

export function filterConnectorCatalogEntries(
  params: ConnectorCatalogFilterParams,
): readonly ConnectorCatalogEntry[] {
  const tokens = params.query
    .toLowerCase()
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0);

  return CONNECTOR_CATALOG.filter((entry) => {
    if (
      params.capability !== "all" &&
      entry.capabilityCategory !== params.capability
    ) {
      return false;
    }
    if (params.transport !== "all" && entry.mcpTransport !== params.transport) {
      return false;
    }
    if (tokens.length === 0) {
      return true;
    }
    const haystack = [
      entry.connectorId,
      entry.connectorKey,
      entry.provider,
      entry.npmPackage,
      entry.shortTitle,
      entry.capabilitySummary,
    ]
      .join(" ")
      .toLowerCase();
    return tokens.every((token) => haystack.includes(token));
  });
}

/** Guards catalog integrity for unit tests. */
export function validateConnectorCatalog(): string[] {
  const errors: string[] = [];
  const ids = new Set<string>();
  const keys = new Set<string>();

  if (catalogSnapshot.schemaVersion !== 2) {
    errors.push(
      `Unexpected schemaVersion: ${String(catalogSnapshot.schemaVersion)}`,
    );
  }
  if (catalogSnapshot.connectorCount !== catalogSnapshot.connectors.length) {
    errors.push("connectorCount does not match connectors array length");
  }
  if (CONNECTOR_CATALOG.length !== 45) {
    errors.push(
      `Expected 45 catalog entries, got ${String(CONNECTOR_CATALOG.length)}`,
    );
  }

  for (const entry of CONNECTOR_CATALOG) {
    if (ids.has(entry.connectorId)) {
      errors.push(`Duplicate connectorId: ${entry.connectorId}`);
    }
    ids.add(entry.connectorId);
    if (keys.has(entry.connectorKey)) {
      errors.push(`Duplicate connectorKey: ${entry.connectorKey}`);
    }
    keys.add(entry.connectorKey);

    if (!entry.npmPackage.startsWith("@osva-ai/connector-")) {
      errors.push(`${entry.connectorId}: unexpected npm package name`);
    }
    if (entry.npmPublishStatus !== "published") {
      errors.push(`${entry.connectorId}: npmPublishStatus is not published`);
    }
    if (
      entry.tools.count !==
      entry.tools.readOnly.length + entry.tools.mutationCapable.length
    ) {
      errors.push(`${entry.connectorId}: tool count mismatch`);
    }

    if (!isAllowedOsvaConnectorsUrl(entry.installGuideUrl)) {
      errors.push(`${entry.connectorId}: install guide URL failed allowlist`);
    }
    if (!isAllowedOsvaConnectorsUrl(entry.packageReadmeUrl)) {
      errors.push(`${entry.connectorId}: package README URL failed allowlist`);
    }
    if (!isAllowedOsvaConnectorsUrl(entry.npmPackageUrl)) {
      errors.push(`${entry.connectorId}: npm URL failed allowlist`);
    }
  }

  return errors;
}
