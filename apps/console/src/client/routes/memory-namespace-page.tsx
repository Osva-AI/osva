import { useState, type FormEvent } from "react";
import { useParams } from "react-router-dom";

import { MemoryRecordInspector } from "../components/memory/memory-record-inspector";
import { EmptyState } from "../components/empty-state/empty-state";
import { ErrorState } from "../components/error-state/error-state";
import { LoadingBlock } from "../components/loading/loading-block";
import { LinkButton } from "../components/ui/button";
import { TextField } from "../components/ui/field";
import { PageHeader } from "../components/ui/page-header";
import { SectionPanel } from "../components/ui/section-panel";
import {
  useMemoryNamespaceQuery,
  useMemoryRecordsQuery,
} from "../hooks/use-knowledge-memory";

export function MemoryNamespacePage() {
  const { namespaceId } = useParams();
  const namespaceQuery = useMemoryNamespaceQuery(namespaceId);
  const [prefixInput, setPrefixInput] = useState("");
  const [prefixFilter, setPrefixFilter] = useState<string | undefined>();
  const [cursor, setCursor] = useState<string | undefined>();

  const recordsQuery = useMemoryRecordsQuery(namespaceId, {
    prefix: prefixFilter,
    limit: 50,
    cursor,
  });

  function applyPrefixFilter(nextPrefix: string): void {
    const trimmed = nextPrefix.trim();
    setPrefixFilter(trimmed.length > 0 ? trimmed : undefined);
    setCursor(undefined);
  }

  function handleFilterSubmit(event: FormEvent): void {
    event.preventDefault();
    applyPrefixFilter(prefixInput);
  }

  if (namespaceQuery.isLoading) {
    return <LoadingBlock label="Loading namespace…" />;
  }
  if (namespaceQuery.isError) {
    return (
      <ErrorState
        title="Failed to load namespace"
        error={namespaceQuery.error}
      />
    );
  }

  const namespace = namespaceQuery.data;
  if (namespace === undefined) {
    return <p className="muted">Namespace not found.</p>;
  }

  const recordsLoading =
    recordsQuery.isPending && recordsQuery.data === undefined;

  return (
    <div
      className="memory-v2 page-stack activity-v2"
      data-testid="memory-namespace-detail-page"
    >
      <PageHeader
        title={namespace.name}
        subtitle={
          namespace.description !== undefined &&
          namespace.description.length > 0
            ? namespace.description
            : "JSON records in this namespace are read through the memory gateway at run time."
        }
        actions={
          <>
            <LinkButton variant="secondary" to="/memory">
              All namespaces
            </LinkButton>
            <button
              type="button"
              className="button"
              onClick={() => void recordsQuery.refetch()}
              disabled={recordsQuery.isFetching}
            >
              Refresh records
            </button>
          </>
        }
      />

      <SectionPanel title="Namespace details">
        <dl className="meta-grid">
          <div>
            <dt>Key</dt>
            <dd className="mono">{namespace.key}</dd>
          </div>
          <div>
            <dt>Created</dt>
            <dd>{new Date(namespace.createdAt).toLocaleString()}</dd>
          </div>
        </dl>
        <details className="memory-v2-tech-details">
          <summary>Technical identifiers</summary>
          <p className="mono memory-v2-id-line">Namespace ID: {namespace.id}</p>
        </details>
        <p className="muted memory-v2-sensitive-note" role="note">
          Record values may contain sensitive data. UI previews are truncated by
          default — expanding a value shows the full JSON from the API. This
          view is not an authorization boundary.
        </p>
      </SectionPanel>

      <SectionPanel
        title="Records"
        description="Read-only listing. Prefix filter and cursor pagination match the control plane API."
      >
        <form
          className="memory-v2-filter-form filters"
          onSubmit={handleFilterSubmit}
        >
          <TextField
            id="record-prefix"
            label="Key prefix filter"
            value={prefixInput}
            onChange={(event) => setPrefixInput(event.target.value)}
            hint="Apply to list keys starting with this prefix. Clears pagination."
          />
          <div className="toolbar">
            <button type="submit" className="button primary">
              Apply filter
            </button>
            <button
              type="button"
              className="button"
              onClick={() => {
                setPrefixInput("");
                applyPrefixFilter("");
              }}
            >
              Clear
            </button>
          </div>
        </form>

        {recordsLoading ? <LoadingBlock label="Loading records…" /> : null}
        {recordsQuery.isError ? (
          <ErrorState
            title="Failed to load records"
            error={recordsQuery.error}
          />
        ) : null}

        {recordsQuery.data !== undefined ? (
          <>
            {recordsQuery.data.items.length === 0 ? (
              <EmptyState
                title="No records in this namespace"
                description={
                  prefixFilter !== undefined
                    ? "No keys match the current prefix filter."
                    : "Records appear when agents or integrations write through the memory gateway."
                }
              />
            ) : (
              <div className="memory-v2-record-list stack" role="list">
                {recordsQuery.data.items.map((record) => (
                  <MemoryRecordInspector key={record.key} record={record} />
                ))}
              </div>
            )}
            {recordsQuery.data.nextCursor !== undefined ? (
              <button
                type="button"
                className="button"
                onClick={() => setCursor(recordsQuery.data?.nextCursor)}
              >
                Next page
              </button>
            ) : null}
            {cursor !== undefined ? (
              <button
                type="button"
                className="button button-secondary"
                onClick={() => setCursor(undefined)}
              >
                Back to first page
              </button>
            ) : null}
          </>
        ) : null}
      </SectionPanel>
    </div>
  );
}
