import { Link, useParams } from "react-router-dom";

import { JsonView } from "../components/json-view/json-view";
import { ErrorState } from "../components/error-state/error-state";
import { LoadingBlock } from "../components/loading/loading-block";
import {
  useToolQuery,
  useToolVersionsQuery,
  type McpToolVersionResource,
} from "../hooks/use-tools-connectors";

export function ToolDetailPage() {
  const { toolId } = useParams<{ toolId: string }>();
  const toolQuery = useToolQuery(toolId);
  const versionsQuery = useToolVersionsQuery(toolId);

  if (toolId === undefined) {
    return (
      <ErrorState title="Invalid route" error={new Error("Missing toolId.")} />
    );
  }

  if (toolQuery.isLoading || versionsQuery.isLoading) {
    return <LoadingBlock label="Loading tool…" />;
  }

  return (
    <>
      <header className="page-header">
        <div>
          <h1 className="page-title">{toolQuery.data?.name ?? "Tool"}</h1>
          <p className="page-subtitle mono">{toolId}</p>
        </div>
        <Link className="button" to="/tools">
          Back to tools
        </Link>
      </header>

      {toolQuery.data !== undefined ? (
        <section className="panel">
          <h2 className="section-title">Identity</h2>
          <p>
            Key <span className="mono">{toolQuery.data.key}</span>
          </p>
        </section>
      ) : null}

      {versionsQuery.data !== undefined ? (
        <section className="panel">
          <h2 className="section-title">Immutable versions</h2>
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Version</th>
                  <th>Type</th>
                  <th>Implementation</th>
                  <th>MCP origin</th>
                  <th>Version ID</th>
                </tr>
              </thead>
              <tbody>
                {versionsQuery.data.versions.map((version) => {
                  const mcp =
                    version.type === "MCP"
                      ? (version as McpToolVersionResource)
                      : undefined;
                  return (
                    <tr key={version.id}>
                      <td>{version.version}</td>
                      <td>{version.type}</td>
                      <td className="mono">
                        {version.type === "INTERNAL"
                          ? version.implementation
                          : version.implementation}
                      </td>
                      <td className="mono">
                        {mcp === undefined ? "—" : mcp.mcp.connectorVersionId}
                      </td>
                      <td className="mono">{version.id}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {versionsQuery.data.versions.map((version) =>
            version.type === "MCP" ? (
              <div key={`schema-${version.id}`} className="panel nested">
                <h3 className="section-title">
                  v{version.version} input schema ({version.id})
                </h3>
                <p className="muted">
                  Remote tool{" "}
                  <span className="mono">
                    {(version as McpToolVersionResource).mcp.remoteToolName}
                  </span>
                </p>
                <JsonView
                  value={(version as McpToolVersionResource).mcp.inputSchema}
                />
              </div>
            ) : null,
          )}
        </section>
      ) : null}
    </>
  );
}
