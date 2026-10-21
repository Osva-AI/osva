import { useState, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";

import { ErrorState } from "../components/error-state/error-state";
import { LoadingBlock } from "../components/loading/loading-block";
import { useAuth } from "../context/auth-context";
import {
  useCreateKnowledgeIndexMutation,
  useKnowledgeIndexesQuery,
  useKnowledgeRetrieveMutation,
  useKnowledgeSourceQuery,
  useRetryKnowledgeIndexMutation,
  type KnowledgeHitResource,
  type KnowledgeIndexResource,
} from "../hooks/use-knowledge-memory";
import { roleCanWriteControlPlaneResources } from "../lib/permissions";

function IndexStatusPanel(props: {
  readonly index: KnowledgeIndexResource;
  readonly canWrite: boolean;
  readonly onRetry: () => void;
  readonly retryPending: boolean;
}) {
  const { index } = props;
  return (
    <div className="panel nested">
      <h3 className="section-title">
        Index <span className="mono">{index.id}</span>
      </h3>
      <dl className="meta-grid">
        <div>
          <dt>Status</dt>
          <dd>{index.status}</dd>
        </div>
        <div>
          <dt>Parser</dt>
          <dd>
            {index.parserKey}@{index.parserVersion}
          </dd>
        </div>
        <div>
          <dt>Chunks</dt>
          <dd>{index.chunkCount ?? "—"}</dd>
        </div>
        <div>
          <dt>Embedded</dt>
          <dd>{index.embeddedChunkCount ?? "—"}</dd>
        </div>
        <div>
          <dt>Attempts</dt>
          <dd>{index.attemptCount}</dd>
        </div>
        {index.readyAt !== undefined ? (
          <div>
            <dt>Ready at</dt>
            <dd>{new Date(index.readyAt).toLocaleString()}</dd>
          </div>
        ) : null}
      </dl>
      {index.lastErrorCode !== undefined ? (
        <p className="error-inline" role="alert">
          {index.lastErrorCode}
          {index.lastErrorMessage !== undefined
            ? `: ${index.lastErrorMessage}`
            : ""}
        </p>
      ) : null}
      {index.status === "FAILED" && props.canWrite ? (
        <button
          type="button"
          className="button"
          disabled={props.retryPending}
          onClick={props.onRetry}
        >
          Retry indexing
        </button>
      ) : null}
    </div>
  );
}

export function KnowledgeSourcePage() {
  const { sourceId } = useParams();
  const auth = useAuth();
  const role = auth.selectedWorkspace?.role;
  const canWrite =
    role !== undefined && roleCanWriteControlPlaneResources(role);

  const sourceQuery = useKnowledgeSourceQuery(sourceId);
  const indexesQuery = useKnowledgeIndexesQuery(sourceId);
  const createIndexMutation = useCreateKnowledgeIndexMutation(sourceId ?? "");
  const retryMutation = useRetryKnowledgeIndexMutation();
  const retrieveMutation = useKnowledgeRetrieveMutation();

  const [retrieveQuery, setRetrieveQuery] = useState("");
  const [selectedIndexIds, setSelectedIndexIds] = useState<string[]>([]);
  const [hits, setHits] = useState<readonly KnowledgeHitResource[]>([]);
  const [retrieveError, setRetrieveError] = useState<string | undefined>();

  const readyIndexes =
    indexesQuery.data?.items.filter((index) => index.status === "READY") ?? [];

  async function handleCreateIndex(): Promise<void> {
    if (!canWrite || sourceId === undefined) {
      return;
    }
    await createIndexMutation.mutateAsync();
    await indexesQuery.refetch();
  }

  async function handleRetrieve(event: FormEvent): Promise<void> {
    event.preventDefault();
    setRetrieveError(undefined);
    setHits([]);
    const ids =
      selectedIndexIds.length > 0
        ? selectedIndexIds
        : readyIndexes.map((index) => index.id);
    if (ids.length === 0) {
      setRetrieveError("Select at least one READY index to search.");
      return;
    }
    try {
      const result = await retrieveMutation.mutateAsync({
        knowledgeIndexIds: ids,
        query: retrieveQuery.trim(),
        topK: 5,
      });
      setHits(result.hits);
    } catch (error) {
      setRetrieveError(
        error instanceof Error ? error.message : "Retrieval failed.",
      );
    }
  }

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

  return (
    <>
      <header className="page-header">
        <div>
          <p className="muted">
            <Link to="/knowledge">Knowledge</Link>
          </p>
          <h1 className="page-title">{source.name}</h1>
          <p className="page-subtitle">
            Key <span className="mono">{source.key}</span> · Artifact{" "}
            <span className="mono">{source.artifactId}</span>
          </p>
        </div>
        <div className="toolbar">
          {canWrite ? (
            <button
              type="button"
              className="button primary"
              disabled={createIndexMutation.isPending}
              onClick={() => void handleCreateIndex()}
            >
              Create index
            </button>
          ) : null}
          <button
            type="button"
            className="button"
            onClick={() => void indexesQuery.refetch()}
          >
            Refresh indexes
          </button>
        </div>
      </header>

      {indexesQuery.isLoading ? (
        <LoadingBlock label="Loading indexes…" />
      ) : null}

      {indexesQuery.data?.items.map((index) => (
        <IndexStatusPanel
          key={index.id}
          index={index}
          canWrite={canWrite}
          retryPending={retryMutation.isPending}
          onRetry={() => void retryMutation.mutateAsync(index.id)}
        />
      ))}

      <section className="panel">
        <h2 className="section-title">Test retrieval</h2>
        <p className="muted">
          Search READY indexes only. Results show backend-provided text, scores,
          and references.
        </p>
        <form
          className="filters"
          onSubmit={(event) => void handleRetrieve(event)}
        >
          <div className="field">
            <label htmlFor="retrieve-query">Query</label>
            <input
              id="retrieve-query"
              value={retrieveQuery}
              onChange={(event) => setRetrieveQuery(event.target.value)}
              required
            />
          </div>
          {readyIndexes.length > 0 ? (
            <div className="field">
              <span className="field-label">
                READY indexes (optional filter)
              </span>
              {readyIndexes.map((index) => (
                <label key={index.id}>
                  <input
                    type="checkbox"
                    checked={selectedIndexIds.includes(index.id)}
                    onChange={(event) => {
                      setSelectedIndexIds((current) => {
                        if (event.target.checked) {
                          return [...current, index.id];
                        }
                        return current.filter((id) => id !== index.id);
                      });
                    }}
                  />{" "}
                  <span className="mono">{index.id}</span>
                </label>
              ))}
            </div>
          ) : (
            <p className="muted">No READY indexes on this source yet.</p>
          )}
          <button
            type="submit"
            className="button primary"
            disabled={retrieveMutation.isPending || readyIndexes.length === 0}
          >
            Retrieve
          </button>
        </form>
        {retrieveError !== undefined ? (
          <p className="error-inline" role="alert">
            {retrieveError}
          </p>
        ) : null}
        {hits.length > 0 ? (
          <ul>
            {hits.map((hit) => (
              <li key={hit.knowledgeChunkId}>
                <p className="mono">
                  score={hit.score} index={hit.knowledgeIndexId}
                </p>
                <p>{hit.text}</p>
              </li>
            ))}
          </ul>
        ) : null}
      </section>
    </>
  );
}
