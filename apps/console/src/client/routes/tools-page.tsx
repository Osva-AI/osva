import { Link } from "react-router-dom";

import { IntegrationsConceptsPanel } from "../components/integrations/integrations-concepts-panel";
import { IntegrationsSectionNav } from "../components/integrations/integrations-section-nav";
import { EmptyState } from "../components/empty-state/empty-state";
import { ErrorState } from "../components/error-state/error-state";
import { LoadingBlock } from "../components/loading/loading-block";
import { LinkButton } from "../components/ui/button";
import { DataTableRegion } from "../components/ui/data-table-region";
import { PageHeader } from "../components/ui/page-header";
import { SectionPanel } from "../components/ui/section-panel";
import { useAuthContextQuery } from "../hooks/use-auth-context";
import {
  useToolsCatalogQuery,
  type ToolVersionResource,
} from "../hooks/use-tools-connectors";
import {
  describeIntegrationsWriteRoleRequirement,
  formatToolTypeLabel,
  summarizeToolVersion,
} from "../lib/tool-resource-presentation";
import { roleCanWriteControlPlaneResources } from "../lib/permissions";
import { useWorkspaceQueryScope } from "../hooks/use-workspace-query-scope";

function latestVersion(
  versions: readonly ToolVersionResource[],
): ToolVersionResource | undefined {
  if (versions.length === 0) {
    return undefined;
  }
  return versions.reduce((left, right) =>
    right.version > left.version ? right : left,
  );
}

export function ToolsPage() {
  const workspaceId = useWorkspaceQueryScope();
  const authQuery = useAuthContextQuery();
  const catalogQuery = useToolsCatalogQuery();
  const canWrite =
    authQuery.data !== undefined &&
    roleCanWriteControlPlaneResources(authQuery.data.role);

  if (workspaceId === undefined) {
    return <LoadingBlock label="Select a workspace to view tools." />;
  }

  const initialLoading =
    catalogQuery.isPending && catalogQuery.data === undefined;

  return (
    <div
      className="integrations-v2 page-stack activity-v2"
      data-testid="integrations-tools-page"
    >
      <PageHeader
        title="Tools & integrations"
        subtitle="Registry of internal and MCP tools. Connectors import MCP capabilities as immutable ToolVersions."
        actions={
          <>
            {catalogQuery.isFetching && !initialLoading ? (
              <span className="muted activity-v2-refresh-hint" role="status">
                Refreshing…
              </span>
            ) : null}
            <LinkButton variant="secondary" to="/tools/connectors/catalog">
              Connector catalog
            </LinkButton>
            <LinkButton variant="primary" to="/tools/connectors">
              Workspace connectors
            </LinkButton>
            <button
              type="button"
              className="button"
              onClick={() => void catalogQuery.refetch()}
              disabled={catalogQuery.isFetching}
            >
              Refresh
            </button>
          </>
        }
      />

      <IntegrationsSectionNav active="tools" />
      <IntegrationsConceptsPanel />

      {!canWrite ? (
        <section className="activity-v2-degraded" role="status">
          <p className="activity-v2-degraded-title">Read-only access</p>
          <p className="muted">{describeIntegrationsWriteRoleRequirement()}</p>
        </section>
      ) : null}

      {initialLoading ? <LoadingBlock label="Loading tools…" /> : null}
      {catalogQuery.isError ? (
        <ErrorState title="Failed to load tools" error={catalogQuery.error} />
      ) : null}

      {catalogQuery.data !== undefined ? (
        <SectionPanel
          title="Tool registry"
          description="Latest version is shown for discovery only. Agents bind a specific ToolVersion."
        >
          {catalogQuery.data.length === 0 ? (
            <EmptyState
              title="No tools in this workspace"
              description="Import MCP tools from a connector, or register internal tools through the control plane API."
              action={
                canWrite ? (
                  <LinkButton variant="primary" to="/tools/connectors">
                    Set up MCP connector
                  </LinkButton>
                ) : undefined
              }
            />
          ) : (
            <DataTableRegion caption="Workspace tools">
              <thead>
                <tr>
                  <th scope="col">Name</th>
                  <th scope="col">Kind</th>
                  <th scope="col">Latest</th>
                  <th scope="col">Versions</th>
                  <th scope="col">Capability</th>
                  <th scope="col">Key</th>
                </tr>
              </thead>
              <tbody>
                {catalogQuery.data.map(({ tool, versions }) => {
                  const latest = latestVersion(versions);
                  const summary =
                    latest !== undefined
                      ? summarizeToolVersion(latest)
                      : undefined;
                  return (
                    <tr key={tool.id}>
                      <td>
                        <Link to={`/tools/${tool.id}`}>{tool.name}</Link>
                      </td>
                      <td>
                        {summary !== undefined
                          ? formatToolTypeLabel(latest?.type ?? "—")
                          : "—"}
                      </td>
                      <td>
                        {latest === undefined
                          ? "—"
                          : `v${String(latest.version)}`}
                      </td>
                      <td>{versions.length}</td>
                      <td>{summary?.capability ?? "—"}</td>
                      <td className="mono">
                        <details className="integrations-v2-tech-details">
                          <summary>Show key</summary>
                          {tool.key}
                        </details>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </DataTableRegion>
          )}
        </SectionPanel>
      ) : null}
    </div>
  );
}
