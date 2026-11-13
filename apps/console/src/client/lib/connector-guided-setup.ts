import type { CatalogWorkspaceIntegrationStatus } from "./connector-workspace-status";
import type {
  ConnectorCatalogEntry,
  ConnectorCatalogTransport,
} from "./osva-connectors-catalog";
import type { ConnectorVersionResource } from "../hooks/use-tools-connectors";

export type ConnectorSetupStepId =
  "requirements" | "workspace" | "transport" | "prerequisites" | "discover";

export const CONNECTOR_SETUP_STEPS: readonly {
  readonly id: ConnectorSetupStepId;
  readonly title: string;
  readonly summary: string;
}[] = [
  {
    id: "requirements",
    title: "Requirements",
    summary: "Package, runtime, and credential expectations",
  },
  {
    id: "workspace",
    title: "Workspace connector",
    summary: "Create a linked connector identity when authorized",
  },
  {
    id: "transport",
    title: "Transport configuration",
    summary: "STDIO operator provisioning or Streamable HTTP versions",
  },
  {
    id: "prerequisites",
    title: "Verify prerequisites",
    summary: "Operator gates, worker package availability, env names",
  },
  {
    id: "discover",
    title: "Discover tools",
    summary: "MCP discovery and selective ToolVersion import",
  },
];

const SETUP_STEP_ORDER: readonly ConnectorSetupStepId[] =
  CONNECTOR_SETUP_STEPS.map((step) => step.id);

export type ConnectorSetupStepVisualState =
  "complete" | "current" | "upcoming" | "needs_attention";

export type ConnectorJourneyEvidenceLabel =
  | "available-in-catalog"
  | "no-linked-workspace-connector"
  | "workspace-connector-created"
  | "connector-version-available"
  | "tools-imported"
  | "ready-for-agent-binding";

export function mapIntegrationStatusToJourneyLabel(
  status: CatalogWorkspaceIntegrationStatus,
): ConnectorJourneyEvidenceLabel {
  switch (status) {
    case "catalog-only":
      return "no-linked-workspace-connector";
    case "identity-created":
      return "workspace-connector-created";
    case "version-configured":
      return "connector-version-available";
    case "tools-imported":
      return "tools-imported";
  }
}

export function describeJourneyEvidenceLabel(
  label: ConnectorJourneyEvidenceLabel,
): string {
  switch (label) {
    case "available-in-catalog":
      return "Available in catalog · not configured in this workspace";
    case "no-linked-workspace-connector":
      return "No linked workspace connector (connectorKey match only)";
    case "workspace-connector-created":
      return "Workspace connector created · no ConnectorVersion yet";
    case "connector-version-available":
      return "ConnectorVersion available · MCP tools not imported";
    case "tools-imported":
      return "MCP ToolVersions imported · provider connectivity not verified";
    case "ready-for-agent-binding":
      return "Tools imported · ready to bind on an AgentVersion (execution auth is separate)";
  }
}

export function isSetupStepId(value: string): value is ConnectorSetupStepId {
  return SETUP_STEP_ORDER.includes(value as ConnectorSetupStepId);
}

export function parseSetupStepId(
  value: string | null,
): ConnectorSetupStepId | undefined {
  if (value === null || value.length === 0) {
    return undefined;
  }
  return isSetupStepId(value) ? value : undefined;
}

export function buildVerifiedWorkerPackageInstallCommand(
  entry: Pick<ConnectorCatalogEntry, "npmPackage" | "publishedVersion">,
): string {
  return `npm install ${entry.npmPackage}@${entry.publishedVersion}`;
}

export function describeNodeRuntimeRequirement(sdkVersion: string): string {
  return `Node.js 20+ required for connector packages using @osva-ai/connector-sdk ${sdkVersion} (worker runtime must match).`;
}

export function describeStdioOperatorBoundary(): string {
  return "STDIO MCP connectors require OSVA_MCP_STDIO_CONNECTORS_ENABLED on web, worker, and mcp-server. Console cannot enable this flag or provision arbitrary STDIO commands.";
}

export function describeAuthenticationGuidance(
  entry: ConnectorCatalogEntry,
): readonly string[] {
  const lines: string[] = [
    `Documented method: ${entry.authentication.method} (catalog metadata; not live provider verification).`,
    "Listed environment variable names are configuration references — not proof that secrets are stored or resolved.",
  ];
  if (entry.authentication.requiredCredentialEnv.length === 0) {
    lines.push(
      "No required credential env names are listed in the pinned catalog snapshot.",
    );
  } else {
    lines.push(
      "Review each listed name against the installation guide for whether it is mandatory for your deployment.",
    );
  }
  return lines;
}

export function resolveLinkedConnectorVersions(
  connectorId: string | undefined,
  versions: readonly ConnectorVersionResource[] | undefined,
): readonly ConnectorVersionResource[] {
  if (connectorId === undefined || versions === undefined) {
    return [];
  }
  return versions.filter((version) => version.connectorId === connectorId);
}

export function connectorSetupStepComplete(params: {
  readonly stepId: ConnectorSetupStepId;
  readonly integrationStatus: CatalogWorkspaceIntegrationStatus;
  readonly transport: ConnectorCatalogTransport;
  readonly linkedVersions: readonly ConnectorVersionResource[];
}): boolean {
  switch (params.stepId) {
    case "requirements":
      return true;
    case "workspace":
      return params.integrationStatus !== "catalog-only";
    case "transport": {
      if (params.transport === "streamable_http") {
        return params.linkedVersions.some(
          (version) => version.transport === "STREAMABLE_HTTP",
        );
      }
      return params.linkedVersions.some(
        (version) => version.transport === "STDIO",
      );
    }
    case "prerequisites":
      return (
        params.integrationStatus === "version-configured" ||
        params.integrationStatus === "tools-imported"
      );
    case "discover":
      return params.integrationStatus === "tools-imported";
  }
}

export function deriveRecommendedSetupStep(
  integrationStatus: CatalogWorkspaceIntegrationStatus,
): ConnectorSetupStepId {
  switch (integrationStatus) {
    case "catalog-only":
      return "workspace";
    case "identity-created":
      return "transport";
    case "version-configured":
      return "discover";
    case "tools-imported":
      return "discover";
  }
}

export function resolveSetupStepVisualState(
  stepId: ConnectorSetupStepId,
  params: {
    readonly integrationStatus: CatalogWorkspaceIntegrationStatus;
    readonly transport: ConnectorCatalogTransport;
    readonly linkedVersions: readonly ConnectorVersionResource[];
    readonly focusStepId: ConnectorSetupStepId;
  },
): ConnectorSetupStepVisualState {
  const index = SETUP_STEP_ORDER.indexOf(stepId);
  const focusIndex = SETUP_STEP_ORDER.indexOf(params.focusStepId);
  const complete = connectorSetupStepComplete({
    stepId,
    integrationStatus: params.integrationStatus,
    transport: params.transport,
    linkedVersions: params.linkedVersions,
  });

  if (complete) {
    return "complete";
  }
  if (index === focusIndex) {
    return stepId === "prerequisites" &&
      params.integrationStatus === "identity-created" &&
      params.transport === "stdio"
      ? "needs_attention"
      : "current";
  }
  if (index < focusIndex) {
    return complete ? "complete" : "upcoming";
  }
  const recommended = deriveRecommendedSetupStep(params.integrationStatus);
  const recommendedIndex = SETUP_STEP_ORDER.indexOf(recommended);
  if (!complete && index === recommendedIndex && index > focusIndex) {
    return "needs_attention";
  }
  return "upcoming";
}

export function describeSetupStepVisualState(
  state: ConnectorSetupStepVisualState,
): string {
  switch (state) {
    case "complete":
      return "Complete";
    case "current":
      return "In progress";
    case "upcoming":
      return "Upcoming";
    case "needs_attention":
      return "Needs attention";
  }
}

export function streamableHttpOfferedForCatalogTransport(
  transport: ConnectorCatalogTransport,
): boolean {
  return transport === "streamable_http";
}

export function connectorDiscoverHandoffPath(connectorId: string): string {
  return `/tools/connectors/${encodeURIComponent(connectorId)}#discover-import`;
}
