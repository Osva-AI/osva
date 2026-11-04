import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";

import { KnowledgeIndexPanel } from "../components/knowledge/knowledge-index-panel";
import { KnowledgeRetrievalPanel } from "../components/knowledge/knowledge-retrieval-panel";
import { ErrorState } from "../components/error-state/error-state";
import { LoadingBlock } from "../components/loading/loading-block";
import { Button, LinkButton } from "../components/ui/button";
import { PageHeader } from "../components/ui/page-header";
import { SectionPanel } from "../components/ui/section-panel";
import { useAuthContextQuery } from "../hooks/use-auth-context";
import {
  useCreateKnowledgeIndexMutation,
  useKnowledgeIndexesQuery,
  useKnowledgeSourceQuery,
  useRetryKnowledgeIndexMutation,
} from "../hooks/use-knowledge-memory";
import { consoleFetch } from "../lib/console-api";
import { describeKnowledgeWriteRoleRequirement } from "../lib/knowledge-resource-presentation";
import { roleCanWriteControlPlaneResources } from "../lib/permissions";

export function KnowledgeSourcePage() {
  const { sourceId } = useParams();
  const authQuery = useAuthContextQuery();
  const canWrite =
    authQuery.data !== undefined &&
    roleCanWriteControlPlaneResources(authQuery.data.role);

  const sourceQuery = useKnowledgeSourceQuery(sourceId);
  const indexesQuery = useKnowledgeIndexesQuery(sourceId);
  const createIndexMutation = useCreateKnowledgeIndexMutation(sourceId ?? "");
  const retryMutation = useRetryKnowledgeIndexMutation();

  const artifactQuery = useQuery({
    queryKey: ["artifacts", sourceQuery.data?.artifactId],
    enabled: sourceQuery.data?.artifactId !== undefined,
    queryFn: () =>
      consoleFetch<{ id: string; name: string; mediaType: string }>(
        `/api/v1/artifacts/${encodeURIComponent(sourceQuery.data?.artifactId ?? "")}`,
      ),
  });

  if (sourceQuery.isLoading) {
    return <LoadingBlock label="Loading knowledge source…" />;
  }
  if (sourceQuery.isError) {
    return (
      <ErrorState
        title="Failed to load knowledge source"
        error={sourceQuery.error}
      />
    );
  }

  const source = sourceQuery.data;
  if (source === undefined) {
    return <p className="muted">Source not found.</p>;
  }

  const indexes = indexesQuery.data?.items ?? [];
  const readyIndexes = indexes.filter((index) => index.status === "READY");
  const indexesLoading =
    indexesQuery.isPending && indexesQuery.data === undefined;

  async function handleCreateIndex(): Promise<void> {
    if (!canWrite || sourceId === undefined) {
      return;
    }
    await createIndexMutation.mutateAsync();
    await indexesQuery.refetch();
  }

  return (
    <div
      className="knowledge-v2 page-stack activity-v2"
      data-testid="knowledge-source-detail-page"
    >
      <PageHeader
        title={source.name}
        subtitle={
          artifactQuery.data !== undefined
            ? `Artifact: ${artifactQuery.data.name} (${artifactQuery.data.mediaType})`
            : "Workspace artifact-backed knowledge source"
        }
        actions={
          <>
            <LinkButton variant="secondary" to="/knowledge">
              All sources
            </LinkButton>
            {canWrite ? (
              <Button
                type="button"
                variant="primary"
                disabled={createIndexMutation.isPending}
                onClick={() => void handleCreateIndex()}
              >
                Create index
              </Button>
            ) : null}
            <button
              type="button"
              className="button"
              onClick={() => void indexesQuery.refetch()}
              disabled={indexesQuery.isFetching}
            >
              Refresh indexes
            </button>
          </>
        }
      />

      {authQuery.isSuccess && !canWrite ? (
        <section className="activity-v2-degraded" role="status">
          <p className="activity-v2-degraded-title">Read-only access</p>
          <p className="muted">{describeKnowledgeWriteRoleRequirement()}</p>
        </section>
      ) : null}

      <SectionPanel title="Source details">
        <dl className="meta-grid">
          <div>
            <dt>Key</dt>
            <dd className="mono">{source.key}</dd>
          </div>
          <div>
            <dt>Created</dt>
            <dd>{new Date(source.createdAt).toLocaleString()}</dd>
          </div>
          <div>
            <dt>Artifact</dt>
            <dd>
              {artifactQuery.data !== undefined
                ? `${artifactQuery.data.name} (${artifactQuery.data.mediaType})`
                : "—"}
            </dd>
          </div>
        </dl>
        <details className="knowledge-v2-tech-details">
          <summary>Technical identifiers</summary>
          <p className="mono knowledge-v2-id-line">Source ID: {source.id}</p>
          <p className="mono knowledge-v2-id-line">
            Artifact ID: {source.artifactId}
          </p>
        </details>
        <p className="muted">
          <Link to="/knowledge">Knowledge</Link> · Indexing uses the knowledge
          worker (plain text, Markdown, PDF). Create an index to enqueue
          ingestion — status updates come from the API only.
        </p>
      </SectionPanel>

      <SectionPanel
        title="Index history"
        description="Each index is an immutable pipeline run. Retry is available only for FAILED indexes."
      >
        {indexesLoading ? <LoadingBlock label="Loading indexes…" /> : null}
        {indexesQuery.isError ? (
          <ErrorState
            title="Failed to load indexes"
            error={indexesQuery.error}
          />
        ) : null}
        {!indexesLoading && indexes.length === 0 ? (
          <p className="muted" role="status">
            No indexes yet.
            {canWrite
              ? " Use Create index to start ingestion for this artifact."
              : ""}
          </p>
        ) : null}
        <div className="knowledge-v2-index-list stack">
          {indexes.map((index) => (
            <KnowledgeIndexPanel
              key={index.id}
              index={index}
              canWrite={canWrite}
              retryPending={retryMutation.isPending}
              onRetry={() => void retryMutation.mutateAsync(index.id)}
            />
          ))}
        </div>
      </SectionPanel>

      <KnowledgeRetrievalPanel source={source} readyIndexes={readyIndexes} />
    </div>
  );
}
