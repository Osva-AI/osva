import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";

import { IntegrationsSectionNav } from "../components/integrations/integrations-section-nav";
import { JsonView } from "../components/json-view/json-view";
import { ErrorState } from "../components/error-state/error-state";
import { LoadingBlock } from "../components/loading/loading-block";
import { Button, LinkButton } from "../components/ui/button";
import { DataTableRegion } from "../components/ui/data-table-region";
import { PageHeader } from "../components/ui/page-header";
import { SectionPanel } from "../components/ui/section-panel";
import { TextField } from "../components/ui/field";
import { useAuthContextQuery } from "../hooks/use-auth-context";
import {
  useAppendConnectorVersionMutation,
  useConnectorQuery,
  useConnectorVersionsQuery,
  useDiscoverConnectorToolsMutation,
  useImportMcpToolsMutation,
  useUpdateConnectorMutation,
  type DiscoveredMcpTool,
} from "../hooks/use-tools-connectors";
import { roleCanWriteControlPlaneResources } from "../lib/permissions";
import { describeConnectorDiscoveryGuidance } from "../lib/operator-diagnostics";
import { OperatorGuidancePanel } from "../components/operator/operator-guidance";
import {
  connectorTransportSummary,
  describeIntegrationsWriteRoleRequirement,
  formatConnectorAuthSummary,
  formatConnectorVersionOption,
  formatTransportLabel,
} from "../lib/tool-resource-presentation";

type ImportDraft = {
  readonly remoteToolName: string;
  readonly toolKey: string;
  readonly toolName: string;
  readonly selected: boolean;
};

export function ConnectorDetailPage() {
  const { connectorId } = useParams<{ connectorId: string }>();
  const authQuery = useAuthContextQuery();
  const connectorQuery = useConnectorQuery(connectorId);
  const versionsQuery = useConnectorVersionsQuery(connectorId);
  const updateMutation = useUpdateConnectorMutation(connectorId ?? "");
  const appendMutation = useAppendConnectorVersionMutation(connectorId ?? "");

  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [endpointUrl, setEndpointUrl] = useState("");
  const [authType, setAuthType] = useState<"NONE" | "BEARER" | "HEADER">(
    "NONE",
  );
  const [headerName, setHeaderName] = useState("");
  const [secretKey, setSecretKey] = useState("");
  const [selectedVersionId, setSelectedVersionId] = useState("");
  const [discoveredTools, setDiscoveredTools] = useState<
    DiscoveredMcpTool[] | undefined
  >();
  const [importDrafts, setImportDrafts] = useState<ImportDraft[]>([]);
  const [importPhase, setImportPhase] = useState<"idle" | "review" | "done">(
    "idle",
  );
  const [importResult, setImportResult] = useState<
    | ReadonlyArray<{
        readonly toolId: string;
        readonly toolVersionId: string;
        readonly toolKey: string;
      }>
    | undefined
  >();

  const discoverMutation = useDiscoverConnectorToolsMutation(
    connectorId ?? "",
    selectedVersionId,
  );
  const importMutation = useImportMcpToolsMutation();

  const canWrite =
    authQuery.data !== undefined &&
    roleCanWriteControlPlaneResources(authQuery.data.role);

  const versions = versionsQuery.data?.versions ?? [];
  const selectedVersion = versions.find((v) => v.id === selectedVersionId);

  const sortedVersions = useMemo(
    () => [...versions].sort((a, b) => b.version - a.version),
    [versions],
  );

  const discoveryResultGuidance =
    discoveredTools !== undefined && selectedVersion !== undefined
      ? describeConnectorDiscoveryGuidance({
          transport: selectedVersion.transport,
          toolCount: discoveredTools.length,
        })
      : undefined;

  if (connectorId === undefined) {
    return (
      <ErrorState
        title="Invalid route"
        error={new Error("Missing connectorId.")}
      />
    );
  }

  if (connectorQuery.isLoading || versionsQuery.isLoading) {
    return <LoadingBlock label="Loading connector…" />;
  }

  const connector = connectorQuery.data;

  async function discoverTools() {
    setDiscoveredTools(undefined);
    setImportPhase("idle");
    setImportResult(undefined);
    const result = await discoverMutation.mutateAsync();
    setDiscoveredTools(result.tools);
    setImportDrafts(
      result.tools.map((tool) => ({
        remoteToolName: tool.remoteToolName,
        toolKey: tool.remoteToolName.replace(/[^A-Za-z0-9_-]/g, "_"),
        toolName: tool.remoteToolName,
        selected: false,
      })),
    );
  }

  function beginImportReview() {
    const selected = importDrafts.filter((row) => row.selected);
    if (selected.length === 0) {
      return;
    }
    setImportPhase("review");
  }

  async function confirmImport() {
    const selected = importDrafts.filter((row) => row.selected);
    if (selectedVersionId.length === 0 || selected.length === 0) {
      return;
    }
    const imported = await importMutation.mutateAsync({
      connectorVersionId: selectedVersionId,
      tools: selected.map((row) => ({
        remoteToolName: row.remoteToolName,
        toolKey: row.toolKey.trim(),
        toolName: row.toolName.trim(),
      })),
    });
    setImportResult(imported.imported);
    setImportPhase("done");
  }

  return (
    <div
      className="integrations-v2 page-stack activity-v2"
      data-testid="integrations-connector-detail-page"
    >
      <PageHeader
        title={connector?.name ?? "Connector"}
        subtitle={
          connector?.description !== undefined &&
          connector.description.length > 0
            ? connector.description
            : "Review versions, discover MCP tools, and import into the registry."
        }
        actions={
          <LinkButton variant="secondary" to="/tools/connectors">
            Back to connectors
          </LinkButton>
        }
      />

      <IntegrationsSectionNav active="connectors" />

      <details className="integrations-v2-tech-details">
        <summary>Technical identifiers</summary>
        <dl className="meta-list">
          <div>
            <dt>Connector ID</dt>
            <dd className="mono">{connectorId}</dd>
          </div>
          {connector !== undefined ? (
            <div>
              <dt>Key</dt>
              <dd className="mono">{connector.key}</dd>
            </div>
          ) : null}
        </dl>
      </details>

      {!canWrite ? (
        <section className="activity-v2-degraded" role="status">
          <p className="activity-v2-degraded-title">Read-only access</p>
          <p className="muted">{describeIntegrationsWriteRoleRequirement()}</p>
        </section>
      ) : null}

      {canWrite && connector !== undefined ? (
        <SectionPanel title="Update metadata">
          <div className="filters integrations-v2-filters">
            <TextField
              id="connector-edit-name"
              label="Name"
              defaultValue={connector.name}
              onChange={(event) => setEditName(event.target.value)}
            />
            <TextField
              id="connector-edit-description"
              label="Description"
              optional
              defaultValue={connector.description ?? ""}
              onChange={(event) => setEditDescription(event.target.value)}
            />
          </div>
          <Button
            type="button"
            variant="secondary"
            loading={updateMutation.isPending}
            onClick={() =>
              void updateMutation.mutateAsync({
                name:
                  editName.trim().length > 0 ? editName.trim() : connector.name,
                ...(editDescription.trim().length > 0
                  ? { description: editDescription.trim() }
                  : {}),
              })
            }
          >
            Save metadata
          </Button>
        </SectionPanel>
      ) : null}

      <SectionPanel
        title="Immutable versions"
        description="Select a version below for discovery and import."
      >
        <DataTableRegion caption="Connector versions">
          <thead>
            <tr>
              <th scope="col">Version</th>
              <th scope="col">Transport</th>
              <th scope="col">Configuration</th>
              <th scope="col">Auth</th>
            </tr>
          </thead>
          <tbody>
            {sortedVersions.map((version) => (
              <tr key={version.id}>
                <td>
                  {version.version}
                  <details className="integrations-v2-tech-details">
                    <summary className="mono">Version ID</summary>
                    {version.id}
                  </details>
                </td>
                <td>{formatTransportLabel(version.transport)}</td>
                <td className="mono">{connectorTransportSummary(version)}</td>
                <td>{formatConnectorAuthSummary(version)}</td>
              </tr>
            ))}
          </tbody>
        </DataTableRegion>
        {sortedVersions.some((v) => v.transport === "STDIO") ? (
          <p className="muted">
            STDIO ConnectorVersions are shown read-only in Console. New STDIO
            configurations are not offered here — use operator-controlled
            provisioning when STDIO is enabled on the control plane.
          </p>
        ) : null}
      </SectionPanel>

      {canWrite ? (
        <SectionPanel
          title="Append Streamable HTTP version"
          description="Secret reference names are sent once and never returned in API responses."
        >
          <div className="filters integrations-v2-filters">
            <TextField
              id="connector-endpoint"
              label="MCP endpoint URL"
              required
              value={endpointUrl}
              onChange={(event) => setEndpointUrl(event.target.value)}
              placeholder="https://mcp.example.com/mcp"
            />
            <div className="field">
              <label htmlFor="connector-auth-type">Authentication</label>
              <select
                id="connector-auth-type"
                className="ui-control"
                value={authType}
                onChange={(event) =>
                  setAuthType(
                    event.target.value as "NONE" | "BEARER" | "HEADER",
                  )
                }
              >
                <option value="NONE">None</option>
                <option value="BEARER">Bearer token secret</option>
                <option value="HEADER">Header secret</option>
              </select>
            </div>
            {authType === "HEADER" ? (
              <TextField
                id="connector-header-name"
                label="Header name"
                value={headerName}
                onChange={(event) => setHeaderName(event.target.value)}
              />
            ) : null}
            {authType !== "NONE" ? (
              <TextField
                id="connector-secret-key"
                label="Secret reference key"
                value={secretKey}
                onChange={(event) => setSecretKey(event.target.value)}
                autoComplete="off"
              />
            ) : null}
          </div>
          <Button
            type="button"
            variant="primary"
            loading={appendMutation.isPending}
            disabled={endpointUrl.trim().length === 0}
            onClick={() => {
              const auth =
                authType === "BEARER" && secretKey.trim().length > 0
                  ? {
                      type: "BEARER" as const,
                      tokenSecret: { key: secretKey.trim() },
                    }
                  : authType === "HEADER" &&
                      secretKey.trim().length > 0 &&
                      headerName.trim().length > 0
                    ? {
                        type: "HEADER" as const,
                        headerName: headerName.trim(),
                        valueSecret: { key: secretKey.trim() },
                      }
                    : undefined;
              void appendMutation.mutateAsync({
                kind: "MCP",
                transport: "STREAMABLE_HTTP",
                transportConfig: { endpointUrl: endpointUrl.trim() },
                ...(auth === undefined ? {} : { auth }),
              });
            }}
          >
            Append version
          </Button>
          {appendMutation.isError ? (
            <ErrorState
              title="Failed to append ConnectorVersion"
              error={appendMutation.error}
              guidanceContext="generic"
            />
          ) : null}
        </SectionPanel>
      ) : null}

      {canWrite ? (
        <SectionPanel
          id="discover-import"
          title="Discover and import MCP tools"
          description="Discovery lists remote metadata only. Import creates immutable ToolVersions — bind them on an AgentVersion to execute."
        >
          <div className="field">
            <label htmlFor="discover-version">Connector version</label>
            <select
              id="discover-version"
              className="ui-control"
              value={selectedVersionId}
              onChange={(event) => {
                setSelectedVersionId(event.target.value);
                setDiscoveredTools(undefined);
                setImportPhase("idle");
              }}
            >
              <option value="">Select version…</option>
              {sortedVersions.map((version) => (
                <option key={version.id} value={version.id}>
                  {formatConnectorVersionOption(version)}
                </option>
              ))}
            </select>
          </div>
          <Button
            type="button"
            variant="primary"
            loading={discoverMutation.isPending}
            disabled={selectedVersionId.length === 0}
            onClick={() => void discoverTools()}
          >
            Discover tools
          </Button>
          {discoverMutation.isError ? (
            <ErrorState
              title="MCP discovery failed"
              error={discoverMutation.error}
              guidanceContext="connector_discover"
            />
          ) : null}
          {discoveryResultGuidance !== undefined ? (
            <OperatorGuidancePanel guidance={discoveryResultGuidance} />
          ) : null}
          {discoveredTools !== undefined ? (
            <>
              <p role="status">
                Found {discoveredTools.length} remote tool
                {discoveredTools.length === 1 ? "" : "s"} for{" "}
                {selectedVersion !== undefined
                  ? `version ${String(selectedVersion.version)}`
                  : "the selected version"}
                .
              </p>
              <DataTableRegion caption="Discovered MCP tools">
                <thead>
                  <tr>
                    <th scope="col">Import</th>
                    <th scope="col">Remote name</th>
                    <th scope="col">OSVA key</th>
                    <th scope="col">OSVA name</th>
                    <th scope="col">Schema</th>
                  </tr>
                </thead>
                <tbody>
                  {importDrafts.map((row, index) => (
                    <tr key={row.remoteToolName}>
                      <td>
                        <input
                          type="checkbox"
                          checked={row.selected}
                          onChange={(event) => {
                            setImportDrafts((current) =>
                              current.map((item, itemIndex) =>
                                itemIndex === index
                                  ? {
                                      ...item,
                                      selected: event.target.checked,
                                    }
                                  : item,
                              ),
                            );
                          }}
                        />
                      </td>
                      <td className="mono">{row.remoteToolName}</td>
                      <td>
                        <input
                          value={row.toolKey}
                          onChange={(event) => {
                            setImportDrafts((current) =>
                              current.map((item, itemIndex) =>
                                itemIndex === index
                                  ? { ...item, toolKey: event.target.value }
                                  : item,
                              ),
                            );
                          }}
                        />
                      </td>
                      <td>
                        <input
                          value={row.toolName}
                          onChange={(event) => {
                            setImportDrafts((current) =>
                              current.map((item, itemIndex) =>
                                itemIndex === index
                                  ? { ...item, toolName: event.target.value }
                                  : item,
                              ),
                            );
                          }}
                        />
                      </td>
                      <td>
                        <details className="integrations-v2-tech-details">
                          <summary>View schema</summary>
                          <JsonView
                            value={
                              discoveredTools.find(
                                (t) => t.remoteToolName === row.remoteToolName,
                              )?.inputSchema ?? {}
                            }
                          />
                        </details>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </DataTableRegion>
              {importPhase === "idle" ? (
                <Button
                  type="button"
                  variant="primary"
                  disabled={!importDrafts.some((row) => row.selected)}
                  onClick={beginImportReview}
                >
                  Review import
                </Button>
              ) : null}
              {importPhase === "review" ? (
                <section className="panel nested">
                  <h3 className="section-title">Confirm import</h3>
                  <p>
                    Importing{" "}
                    {importDrafts.filter((row) => row.selected).length} tool
                    {importDrafts.filter((row) => row.selected).length === 1
                      ? ""
                      : "s"}{" "}
                    against ConnectorVersion{" "}
                    <span className="mono">{selectedVersionId}</span>
                    {selectedVersion !== undefined
                      ? ` (transport ${selectedVersion.transport})`
                      : ""}
                    .
                  </p>
                  <ul>
                    {importDrafts
                      .filter((row) => row.selected)
                      .map((row) => (
                        <li key={row.remoteToolName}>
                          {row.remoteToolName} → key{" "}
                          <span className="mono">{row.toolKey}</span> (
                          {row.toolName})
                        </li>
                      ))}
                  </ul>
                  <Button
                    type="button"
                    variant="primary"
                    loading={importMutation.isPending}
                    onClick={() => void confirmImport()}
                  >
                    Confirm import
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => setImportPhase("idle")}
                  >
                    Back
                  </Button>
                </section>
              ) : null}
              {importMutation.isError ? (
                <ErrorState
                  title="Tool import failed"
                  error={importMutation.error}
                  guidanceContext="connector_import"
                />
              ) : null}
              {importPhase === "done" && importResult !== undefined ? (
                <section className="panel nested">
                  <h3 className="section-title">Import results</h3>
                  <ul>
                    {importResult.map((item) => (
                      <li key={item.toolVersionId}>
                        <Link to={`/tools/${item.toolId}`}>{item.toolKey}</Link>{" "}
                        · ToolVersion{" "}
                        <span className="mono">{item.toolVersionId}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}
            </>
          ) : null}
        </SectionPanel>
      ) : null}
    </div>
  );
}
