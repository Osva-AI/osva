import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";

import { EmptyState } from "../components/empty-state/empty-state";
import { ErrorState } from "../components/error-state/error-state";
import { LoadingBlock } from "../components/loading/loading-block";
import { useAuth } from "../context/auth-context";
import {
  useCreateMemoryNamespaceMutation,
  useMemoryNamespacesQuery,
} from "../hooks/use-knowledge-memory";
import { roleCanWriteControlPlaneResources } from "../lib/permissions";

export function MemoryPage() {
  const auth = useAuth();
  const role = auth.selectedWorkspace?.role;
  const canWrite =
    role !== undefined && roleCanWriteControlPlaneResources(role);
  const namespacesQuery = useMemoryNamespacesQuery();
  const createMutation = useCreateMemoryNamespaceMutation();

  const [key, setKey] = useState("");
  const [name, setName] = useState("");
  const [formError, setFormError] = useState<string | undefined>();

  async function handleCreate(event: FormEvent): Promise<void> {
    event.preventDefault();
    setFormError(undefined);
    if (!canWrite) {
      setFormError("Your role cannot create memory namespaces.");
      return;
    }
    try {
      await createMutation.mutateAsync({ key: key.trim(), name: name.trim() });
      setKey("");
      setName("");
    } catch (error) {
      setFormError(
        error instanceof Error ? error.message : "Failed to create namespace.",
      );
    }
  }

  return (
    <>
      <header className="page-header">
        <div>
          <h1 className="page-title">Memory</h1>
          <p className="page-subtitle">
            Workspace-scoped memory namespaces hold durable JSON records for
            agents. Record writes at run time flow through the memory gateway;
            this studio does not expose arbitrary record mutation APIs.
          </p>
        </div>
        <button
          type="button"
          className="button"
          onClick={() => void namespacesQuery.refetch()}
        >
          Refresh
        </button>
      </header>

      {canWrite ? (
        <section className="panel">
          <h2 className="section-title">Create namespace</h2>
          <form
            className="filters"
            onSubmit={(event) => void handleCreate(event)}
          >
            <div className="field">
              <label htmlFor="mem-key">Key</label>
              <input
                id="mem-key"
                value={key}
                onChange={(event) => setKey(event.target.value)}
                required
              />
            </div>
            <div className="field">
              <label htmlFor="mem-name">Name</label>
              <input
                id="mem-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                required
              />
            </div>
            <button
              type="submit"
              className="button primary"
              disabled={createMutation.isPending}
            >
              Create namespace
            </button>
          </form>
          {formError !== undefined ? (
            <p className="error-inline" role="alert">
              {formError}
            </p>
          ) : null}
        </section>
      ) : (
        <p className="muted">Viewer role: memory namespaces are read-only.</p>
      )}

      {namespacesQuery.isLoading ? (
        <LoadingBlock label="Loading memory namespaces…" />
      ) : null}
      {namespacesQuery.isError ? (
        <ErrorState
          title="Failed to load memory namespaces"
          error={namespacesQuery.error}
        />
      ) : null}

      {namespacesQuery.data !== undefined ? (
        <section className="panel">
          {namespacesQuery.data.items.length === 0 ? (
            <EmptyState
              title="No memory namespaces yet."
              description="Create a namespace, then bind it to an agent with explicit READ_ONLY or READ_WRITE access."
            />
          ) : (
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Key</th>
                    <th>Created</th>
                  </tr>
                </thead>
                <tbody>
                  {namespacesQuery.data.items.map((namespace) => (
                    <tr key={namespace.id}>
                      <td>
                        <Link
                          to={`/memory/namespaces/${encodeURIComponent(namespace.id)}`}
                        >
                          {namespace.name}
                        </Link>
                      </td>
                      <td className="mono">{namespace.key}</td>
                      <td>{new Date(namespace.createdAt).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ) : null}
    </>
  );
}
