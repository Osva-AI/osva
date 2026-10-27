import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";

import { JsonView } from "../components/json-view/json-view";
import { ErrorState } from "../components/error-state/error-state";
import { LoadingBlock } from "../components/loading/loading-block";
import { useAuthContextQuery } from "../hooks/use-auth-context";
import {
  useAppendConnectorVersionMutation,
  useConnectorQuery,
  useConnectorVersionsQuery,
  useDiscoverConnectorToolsMutation,
  useImportMcpToolsMutation,
  useUpdateConnectorMutation,
  type ConnectorVersionResource,
  type DiscoveredMcpTool,
} from "../hooks/use-tools-connectors";
import { roleCanWriteControlPlaneResources } from "../lib/permissions";
import { describeConnectorDiscoveryGuidance } from "../lib/operator-diagnostics";
import { OperatorGuidancePanel } from "../components/operator/operator-guidance";

type ImportDraft = {
  readonly remoteToolName: string;
  readonly toolKey: string;
  readonly toolName: string;
  readonly selected: boolean;
};

function transportSummary(version: ConnectorVersionResource): string {
  const cfg = version.transportConfig;
  if ("endpointUrl" in cfg) {
    return cfg.endpointUrl;
  }
  return `${cfg.command} ${cfg.args.join(" ")}`.trim();
}

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
    <>
      <header className="page-header">
        <div>
          <h1 className="page-title">{connector?.name ?? "Connector"}</h1>
          <p className="page-subtitle mono">{connectorId}</p>
        </div>
        <Link className="button" to="/tools/connectors">
          Back
        </Link>
      </header>

      {canWrite && connector !== undefined ? (
        <section className="panel">
          <h2 className="section-title">Update metadata</h2>
          <div className="filters">
            <div className="field">
              <label htmlFor="connector-edit-name">Name</label>
              <input
                id="connector-edit-name"
                defaultValue={connector.name}
                onChange={(event) => setEditName(event.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="connector-edit-description">Description</label>
              <input
                id="connector-edit-description"
                defaultValue={connector.description ?? ""}
                onChange={(event) => setEditDescription(event.target.value)}
              />
            </div>
          </div>
          <button
            type="button"
            className="button"
            disabled={updateMutation.isPending}
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
          </button>
        </section>
      ) : null}

      <section className="panel">
        <h2 className="section-title">ConnectorVersions</h2>
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Version</th>
                <th>Transport</th>
                <th>Configuration</th>
                <th>Auth</th>
                <th>Version ID</th>
              </tr>
            </thead>
            <tbody>
              {sortedVersions.map((version) => (
                <tr key={version.id}>
                  <td>{version.version}</td>
                  <td>{version.transport}</td>
                  <td className="mono">{transportSummary(version)}</td>
                  <td>
                    {version.auth === undefined
                      ? "—"
                      : version.auth.configured
                        ? version.auth.type
                        : "—"}
                  </td>
                  <td className="mono">{version.id}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {sortedVersions.some((v) => v.transport === "STDIO") ? (
          <p className="muted">
            STDIO ConnectorVersions are shown read-only in Console. New STDIO
            configurations are not offered here — use operator-controlled
            provisioning when STDIO is enabled on the control plane.
          </p>
        ) : null}
      </section>

      {canWrite ? (
        <section className="panel">
          <h2 className="section-title">Append Streamable HTTP version</h2>
          <p className="muted">
            Provide MCP endpoint URL and optional secret reference keys. Secret
            reference names are sent once and never returned in API responses.
          </p>
          <div className="filters">
            <div className="field">
              <label htmlFor="connector-endpoint">MCP endpoint URL</label>
              <input
                id="connector-endpoint"
                value={endpointUrl}
                onChange={(event) => setEndpointUrl(event.target.value)}
                placeholder="https://mcp.example.com/mcp"
              />
            </div>
            <div className="field">
              <label htmlFor="connector-auth-type">Authentication</label>
              <select
                id="connector-auth-type"
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
              <div className="field">
                <label htmlFor="connector-header-name">Header name</label>
                <input
                  id="connector-header-name"
                  value={headerName}
                  onChange={(event) => setHeaderName(event.target.value)}
                />
              </div>
            ) : null}
            {authType !== "NONE" ? (
              <div className="field">
                <label htmlFor="connector-secret-key">
                  Secret reference key
                </label>
                <input
                  id="connector-secret-key"
                  value={secretKey}
                  onChange={(event) => setSecretKey(event.target.value)}
                  autoComplete="off"
                />
              </div>
            ) : null}
          </div>
          <button
            type="button"
            className="button primary"
            disabled={
              appendMutation.isPending || endpointUrl.trim().length === 0
            }
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
          </button>
          {appendMutation.isError ? (
            <ErrorState
              title="Failed to append ConnectorVersion"
              error={appendMutation.error}
              guidanceContext="generic"
            />
          ) : null}
        </section>
      ) : null}

      {canWrite ? (
        <section className="panel">
          <h2 className="section-title">Discover MCP tools</h2>
          <p className="muted">
            Discovery lists remote tool metadata only. Import registers
            immutable ToolVersion snapshots — it does not grant execution
            permission until bound on an AgentVersion.
          </p>
          <div className="field">
            <label htmlFor="discover-version">ConnectorVersion</label>
            <select
              id="discover-version"
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
                  v{version.version} · {version.transport} · {version.id}
                </option>
              ))}
            </select>
          </div>
          <button
            type="button"
            className="button primary"
            disabled={
              selectedVersionId.length === 0 || discoverMutation.isPending
            }
            onClick={() => void discoverTools()}
          >
            {discoverMutation.isPending ? "Discovering…" : "Discover tools"}
          </button>
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
              <p>
                Found {discoveredTools.length} tool
                {discoveredTools.length === 1 ? "" : "s"} on{" "}
                <span className="mono">{selectedVersionId}</span>.
              </p>
              <div className="table-scroll">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Import</th>
                      <th>Remote name</th>
                      <th>OSVA key</th>
                      <th>OSVA name</th>
                      <th>Schema</th>
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
                          <JsonView
                            value={
                              discoveredTools.find(
                                (t) => t.remoteToolName === row.remoteToolName,
                              )?.inputSchema ?? {}
                            }
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {importPhase === "idle" ? (
                <button
                  type="button"
                  className="button primary"
                  disabled={!importDrafts.some((row) => row.selected)}
                  onClick={beginImportReview}
                >
                  Review import
                </button>
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
                  <button
                    type="button"
                    className="button primary"
                    disabled={importMutation.isPending}
                    onClick={() => void confirmImport()}
                  >
                    Confirm import
                  </button>
                  <button
                    type="button"
                    className="button"
                    onClick={() => setImportPhase("idle")}
                  >
                    Back
                  </button>
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
        </section>
      ) : null}
    </>
  );
}
