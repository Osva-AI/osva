import { useParams } from "react-router-dom";

import { LinkButton } from "../components/ui/button";
import { buildAgentPickerHandoffPath } from "../lib/connector-agent-handoff";

import { IntegrationsSectionNav } from "../components/integrations/integrations-section-nav";
import { JsonView } from "../components/json-view/json-view";
import { ErrorState } from "../components/error-state/error-state";
import { LoadingBlock } from "../components/loading/loading-block";
import { DataTableRegion } from "../components/ui/data-table-region";
import { PageHeader } from "../components/ui/page-header";
import { SectionPanel } from "../components/ui/section-panel";
import {
  useToolQuery,
  useToolVersionsQuery,
  type McpToolVersionResource,
  type ToolVersionResource,
} from "../hooks/use-tools-connectors";
import {
  formatToolTypeLabel,
  summarizeToolVersion,
} from "../lib/tool-resource-presentation";

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

  if (toolQuery.isError) {
    return <ErrorState title="Failed to load tool" error={toolQuery.error} />;
  }

  const versions = versionsQuery.data?.versions ?? [];
  const latest = versions.reduce<ToolVersionResource | undefined>(
    (best, version) =>
      best === undefined || version.version > best.version ? version : best,
    undefined,
  );

  const latestSummary =
    latest !== undefined ? summarizeToolVersion(latest) : undefined;

  return (
    <div
      className="integrations-v2 page-stack activity-v2"
      data-testid="integrations-tool-detail-page"
    >
      <PageHeader
        title={toolQuery.data?.name ?? "Tool"}
        subtitle={
          latestSummary !== undefined
            ? `${latestSummary.typeLabel} tool · ${latestSummary.capability}`
            : "Tool detail"
        }
        actions={
          <LinkButton variant="secondary" to="/tools">
            Back to registry
          </LinkButton>
        }
      />

      <IntegrationsSectionNav active="tools" />

      <details className="integrations-v2-tech-details">
        <summary>Technical identifiers</summary>
        <dl className="meta-list">
          <div>
            <dt>Tool ID</dt>
            <dd className="mono">{toolId}</dd>
          </div>
          {toolQuery.data !== undefined ? (
            <div>
              <dt>Key</dt>
              <dd className="mono">{toolQuery.data.key}</dd>
            </div>
          ) : null}
        </dl>
      </details>

      {latest !== undefined ? (
        <SectionPanel
          title="Use in an agent"
          description="Binding selects an immutable ToolVersion on a new AgentVersion. This does not execute the tool."
        >
          <p className="muted">
            Latest ToolVersion: <span className="mono">{latest.id}</span>
            {latest.type === "MCP" ? (
              <>
                {" "}
                · remote{" "}
                <span className="mono">{latest.mcp.remoteToolName}</span>
              </>
            ) : null}
          </p>
          <LinkButton
            variant="primary"
            to={buildAgentPickerHandoffPath([latest.id])}
            data-testid="tool-detail-use-in-agent"
          >
            Use tools in an agent
          </LinkButton>
        </SectionPanel>
      ) : null}

      {versionsQuery.data !== undefined ? (
        <SectionPanel
          title="Immutable versions"
          description="Agent Studio binds one ToolVersion id per logical binding."
        >
          {versions.length === 0 ? (
            <p className="muted" role="status">
              No versions registered for this tool yet.
            </p>
          ) : (
            <>
              <DataTableRegion caption="Tool versions">
                <thead>
                  <tr>
                    <th scope="col">Version</th>
                    <th scope="col">Kind</th>
                    <th scope="col">Origin</th>
                    <th scope="col">Implementation</th>
                  </tr>
                </thead>
                <tbody>
                  {versions.map((version) => {
                    const summary = summarizeToolVersion(version);
                    return (
                      <tr key={version.id}>
                        <td>{version.version}</td>
                        <td>{formatToolTypeLabel(version.type)}</td>
                        <td>{summary.origin}</td>
                        <td className="mono">
                          {version.type === "INTERNAL"
                            ? version.implementation
                            : version.implementation}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </DataTableRegion>
              {versions.map((version) => (
                <details
                  key={`meta-${version.id}`}
                  className="integrations-v2-tech-details integrations-v2-version-details"
                >
                  <summary>
                    v{version.version} · {formatToolTypeLabel(version.type)}{" "}
                    technical details
                  </summary>
                  <dl className="meta-list">
                    <div>
                      <dt>ToolVersion ID</dt>
                      <dd className="mono">{version.id}</dd>
                    </div>
                    {version.type === "MCP" ? (
                      <>
                        <div>
                          <dt>Remote tool name</dt>
                          <dd className="mono">
                            {
                              (version as McpToolVersionResource).mcp
                                .remoteToolName
                            }
                          </dd>
                        </div>
                        <div>
                          <dt>ConnectorVersion ID</dt>
                          <dd className="mono">
                            {
                              (version as McpToolVersionResource).mcp
                                .connectorVersionId
                            }
                          </dd>
                        </div>
                        <div>
                          <dt>Input schema</dt>
                          <dd>
                            <JsonView
                              value={
                                (version as McpToolVersionResource).mcp
                                  .inputSchema
                              }
                            />
                          </dd>
                        </div>
                      </>
                    ) : null}
                  </dl>
                </details>
              ))}
            </>
          )}
        </SectionPanel>
      ) : null}
    </div>
  );
}
