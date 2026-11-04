import { Link } from "react-router-dom";

import { KnowledgeConceptsPanel } from "../components/knowledge/knowledge-concepts-panel";
import { KnowledgeCreateSourceForm } from "../components/knowledge/knowledge-create-source-form";
import { KnowledgeIndexStatus } from "../components/knowledge/knowledge-index-status";
import { EmptyState } from "../components/empty-state/empty-state";
import { ErrorState } from "../components/error-state/error-state";
import { LoadingBlock } from "../components/loading/loading-block";
import { DataTableRegion } from "../components/ui/data-table-region";
import { PageHeader } from "../components/ui/page-header";
import { SectionPanel } from "../components/ui/section-panel";
import { useAuthContextQuery } from "../hooks/use-auth-context";
import { useKnowledgeSourcesCatalogQuery } from "../hooks/use-knowledge-memory";
import {
  describeKnowledgeWriteRoleRequirement,
  summarizeSourceIndexReadiness,
} from "../lib/knowledge-resource-presentation";
import { roleCanWriteControlPlaneResources } from "../lib/permissions";
import { useWorkspaceQueryScope } from "../hooks/use-workspace-query-scope";

export function KnowledgePage() {
  const workspaceId = useWorkspaceQueryScope();
  const authQuery = useAuthContextQuery();
  const catalogQuery = useKnowledgeSourcesCatalogQuery({ limit: 50 });
  const canWrite =
    authQuery.data !== undefined &&
    roleCanWriteControlPlaneResources(authQuery.data.role);

  if (workspaceId === undefined) {
    return <LoadingBlock label="Select a workspace to manage knowledge." />;
  }

  const initialLoading =
    catalogQuery.isPending && catalogQuery.data === undefined;

  return (
    <div
      className="knowledge-v2 page-stack activity-v2"
      data-testid="knowledge-v2-page"
    >
      <PageHeader
        title="Knowledge"
        subtitle="Register workspace artifacts as sources, index them for semantic search, and bind READY indexes to agents."
        actions={
          <>
            {catalogQuery.isFetching && !initialLoading ? (
              <span className="muted activity-v2-refresh-hint" role="status">
                Refreshing…
              </span>
            ) : null}
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

      <KnowledgeConceptsPanel />

      {authQuery.isSuccess && !canWrite ? (
        <section className="activity-v2-degraded" role="status">
          <p className="activity-v2-degraded-title">Read-only access</p>
          <p className="muted">{describeKnowledgeWriteRoleRequirement()}</p>
        </section>
      ) : null}

      {canWrite ? <KnowledgeCreateSourceForm /> : null}

      {initialLoading ? (
        <LoadingBlock label="Loading knowledge sources…" />
      ) : null}
      {catalogQuery.isError ? (
        <ErrorState
          title="Failed to load knowledge sources"
          error={catalogQuery.error}
        />
      ) : null}

      {catalogQuery.data !== undefined ? (
        <SectionPanel
          title="Knowledge sources"
          description="Index readiness reflects live API status — not connectivity probes."
        >
          {catalogQuery.data.length === 0 ? (
            <EmptyState
              title="No knowledge sources yet"
              description="Create a source from an existing artifact, then open it to start indexing."
            />
          ) : (
            <DataTableRegion caption="Workspace knowledge sources">
              <thead>
                <tr>
                  <th scope="col">Name</th>
                  <th scope="col">Indexes</th>
                  <th scope="col">Readiness</th>
                  <th scope="col">Artifact</th>
                  <th scope="col">Key</th>
                </tr>
              </thead>
              <tbody>
                {catalogQuery.data.map(({ source, indexes }) => {
                  const readiness = summarizeSourceIndexReadiness(indexes);
                  return (
                    <tr key={source.id}>
                      <td>
                        <Link
                          to={`/knowledge/sources/${encodeURIComponent(source.id)}`}
                        >
                          {source.name}
                        </Link>
                      </td>
                      <td>{readiness.total}</td>
                      <td className="knowledge-v2-readiness-cell">
                        {readiness.total === 0 ? (
                          <span className="muted">{readiness.headline}</span>
                        ) : (
                          <div className="knowledge-v2-readiness-stack">
                            {readiness.latestStatus !== undefined ? (
                              <KnowledgeIndexStatus
                                status={readiness.latestStatus}
                              />
                            ) : null}
                            {readiness.readyCount > 0 ? (
                              <span className="muted">
                                {readiness.readyCount} of {readiness.total}{" "}
                                READY
                              </span>
                            ) : (
                              <span className="muted">
                                {readiness.total} index
                                {readiness.total === 1 ? "" : "es"}
                              </span>
                            )}
                          </div>
                        )}
                      </td>
                      <td>
                        <details className="knowledge-v2-tech-details">
                          <summary>View artifact ID</summary>
                          <span className="mono">{source.artifactId}</span>
                        </details>
                      </td>
                      <td>
                        <details className="knowledge-v2-tech-details">
                          <summary>Show key</summary>
                          <span className="mono">{source.key}</span>
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
