import { useState } from "react";
import { Link, useParams } from "react-router-dom";

import { ErrorState } from "../components/error-state/error-state";
import { LoadingBlock } from "../components/loading/loading-block";
import {
  useMemoryNamespaceQuery,
  useMemoryRecordsQuery,
} from "../hooks/use-knowledge-memory";

export function MemoryNamespacePage() {
  const { namespaceId } = useParams();
  const namespaceQuery = useMemoryNamespaceQuery(namespaceId);
  const [prefix, setPrefix] = useState("");
  const [cursor, setCursor] = useState<string | undefined>();
  const recordsQuery = useMemoryRecordsQuery(namespaceId, {
    prefix: prefix.trim().length > 0 ? prefix.trim() : undefined,
    limit: 50,
    cursor,
  });

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

  return (
    <>
      <header className="page-header">
        <div>
          <p className="muted">
            <Link to="/memory">Memory</Link>
          </p>
          <h1 className="page-title">{namespace.name}</h1>
          <p className="page-subtitle">
            Key <span className="mono">{namespace.key}</span> · ID{" "}
            <span className="mono">{namespace.id}</span>
          </p>
        </div>
      </header>

      <section className="panel">
        <h2 className="section-title">Records</h2>
        <p className="muted">
          READ_ONLY agent bindings can read records through the runtime gateway.
          Values may contain sensitive data — avoid sharing this view broadly.
        </p>
        <div className="field">
          <label htmlFor="record-prefix">Key prefix filter</label>
          <input
            id="record-prefix"
            value={prefix}
            onChange={(event) => {
              setPrefix(event.target.value);
              setCursor(undefined);
            }}
          />
        </div>
        {recordsQuery.isLoading ? (
          <LoadingBlock label="Loading records…" />
        ) : null}
        {recordsQuery.isError ? (
          <ErrorState
            title="Failed to load records"
            error={recordsQuery.error}
          />
        ) : null}
        {recordsQuery.data !== undefined ? (
          <>
            {recordsQuery.data.items.length === 0 ? (
              <p className="muted">No records in this namespace.</p>
            ) : (
              <div className="table-scroll">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Key</th>
                      <th>Revision</th>
                      <th>Value preview</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recordsQuery.data.items.map((record) => (
                      <tr key={`${record.key}-${String(record.revision)}`}>
                        <td className="mono">{record.key}</td>
                        <td>{record.revision}</td>
                        <td className="mono">{previewValue(record.value)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
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
          </>
        ) : null}
      </section>
    </>
  );
}

function previewValue(value: unknown): string {
  try {
    const text = JSON.stringify(value);
    if (text.length <= 120) {
      return text;
    }
    return `${text.slice(0, 120)}…`;
  } catch {
    return "(value not JSON-serializable)";
  }
}
