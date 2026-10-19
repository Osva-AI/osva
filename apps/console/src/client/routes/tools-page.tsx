import { Link } from "react-router-dom";

import { EmptyState } from "../components/empty-state/empty-state";
import { ErrorState } from "../components/error-state/error-state";
import { LoadingBlock } from "../components/loading/loading-block";
import {
  useToolsCatalogQuery,
  type ToolVersionResource,
} from "../hooks/use-tools-connectors";

function summarizeLatestVersion(versions: readonly ToolVersionResource[]): {
  readonly type: string;
  readonly detail: string;
  readonly versionNumber: number | undefined;
} {
  if (versions.length === 0) {
    return { type: "—", detail: "No versions", versionNumber: undefined };
  }
  const latest = versions.reduce((left, right) =>
    right.version > left.version ? right : left,
  );
  if (latest.type === "INTERNAL") {
    return {
      type: "INTERNAL",
      detail: latest.implementation,
      versionNumber: latest.version,
    };
  }
  return {
    type: "MCP",
    detail: latest.mcp.remoteToolName,
    versionNumber: latest.version,
  };
}

export function ToolsPage() {
  const catalogQuery = useToolsCatalogQuery();

  return (
    <>
      <header className="page-header">
        <div>
          <h1 className="page-title">Tools</h1>
          <p className="page-subtitle">
            Workspace tool registry entries and immutable ToolVersions. Latest
            version shown for display only — AgentVersions bind explicit
            ToolVersion IDs.
          </p>
        </div>
        <div className="toolbar">
          <Link className="button primary" to="/tools/connectors">
            Connectors
          </Link>
          <button
            type="button"
            className="button"
            onClick={() => void catalogQuery.refetch()}
          >
            Refresh
          </button>
        </div>
      </header>

      {catalogQuery.isLoading ? <LoadingBlock label="Loading tools…" /> : null}
      {catalogQuery.isError ? (
        <ErrorState title="Failed to load tools" error={catalogQuery.error} />
      ) : null}

      {catalogQuery.data !== undefined ? (
        <section className="panel">
          {catalogQuery.data.length === 0 ? (
            <EmptyState
              title="No tools yet."
              description="Import MCP tools from a connector or register internal tools through the control plane API."
            />
          ) : (
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Key</th>
                    <th>Type</th>
                    <th>Latest</th>
                    <th>Versions</th>
                    <th>Capability</th>
                  </tr>
                </thead>
                <tbody>
                  {catalogQuery.data.map(({ tool, versions }) => {
                    const summary = summarizeLatestVersion(versions);
                    const mcpLatest =
                      versions.find((v) => v.type === "MCP") ?? undefined;
                    const description =
                      mcpLatest?.type === "MCP"
                        ? (mcpLatest.mcp.description ??
                          mcpLatest.mcp.remoteToolName)
                        : summary.detail;
                    return (
                      <tr key={tool.id}>
                        <td>
                          <Link to={`/tools/${tool.id}`}>{tool.name}</Link>
                        </td>
                        <td className="mono">{tool.key}</td>
                        <td>{summary.type}</td>
                        <td className="mono">
                          {summary.versionNumber === undefined
                            ? "—"
                            : `v${String(summary.versionNumber)}`}
                        </td>
                        <td>{versions.length}</td>
                        <td>{description}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ) : null}
    </>
  );
}
