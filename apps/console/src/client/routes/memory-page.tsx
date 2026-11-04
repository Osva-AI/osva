import { Link } from "react-router-dom";
import { useState, type FormEvent } from "react";

import { MemoryConceptsPanel } from "../components/memory/memory-concepts-panel";
import { EmptyState } from "../components/empty-state/empty-state";
import { ErrorState } from "../components/error-state/error-state";
import { LoadingBlock } from "../components/loading/loading-block";
import { Button } from "../components/ui/button";
import { DataTableRegion } from "../components/ui/data-table-region";
import { TextField } from "../components/ui/field";
import { PageHeader } from "../components/ui/page-header";
import { SectionPanel } from "../components/ui/section-panel";
import { useAuthContextQuery } from "../hooks/use-auth-context";
import {
  useCreateMemoryNamespaceMutation,
  useMemoryNamespacesQuery,
} from "../hooks/use-knowledge-memory";
import { describeMemoryWriteRoleRequirement } from "../lib/memory-resource-presentation";
import { roleCanWriteControlPlaneResources } from "../lib/permissions";
import { useWorkspaceQueryScope } from "../hooks/use-workspace-query-scope";

export function MemoryPage() {
  const workspaceId = useWorkspaceQueryScope();
  const authQuery = useAuthContextQuery();
  const namespacesQuery = useMemoryNamespacesQuery();
  const createMutation = useCreateMemoryNamespaceMutation();
  const canWrite =
    authQuery.data !== undefined &&
    roleCanWriteControlPlaneResources(authQuery.data.role);

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

  if (workspaceId === undefined) {
    return <LoadingBlock label="Select a workspace to manage memory." />;
  }

  const initialLoading =
    namespacesQuery.isPending && namespacesQuery.data === undefined;

  return (
    <div
      className="memory-v2 page-stack activity-v2"
      data-testid="memory-v2-page"
    >
      <PageHeader
        title="Memory"
        subtitle="Workspace namespaces hold durable JSON records for agents. Record writes at run time use the memory gateway — not this UI."
        actions={
          <>
            {namespacesQuery.isFetching && !initialLoading ? (
              <span className="muted activity-v2-refresh-hint" role="status">
                Refreshing…
              </span>
            ) : null}
            <button
              type="button"
              className="button"
              onClick={() => void namespacesQuery.refetch()}
              disabled={namespacesQuery.isFetching}
            >
              Refresh
            </button>
          </>
        }
      />

      <MemoryConceptsPanel />

      {authQuery.isSuccess && !canWrite ? (
        <section className="activity-v2-degraded" role="status">
          <p className="activity-v2-degraded-title">Read-only access</p>
          <p className="muted">{describeMemoryWriteRoleRequirement()}</p>
        </section>
      ) : null}

      {canWrite ? (
        <SectionPanel
          title="Create namespace"
          description="Namespaces are registry identities. Agents bind them with explicit access modes."
        >
          <form
            className="memory-v2-create-form filters"
            onSubmit={(event) => void handleCreate(event)}
          >
            <TextField
              id="mem-key"
              label="Key"
              value={key}
              onChange={(event) => setKey(event.target.value)}
              required
            />
            <TextField
              id="mem-name"
              label="Display name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              required
            />
            <Button
              type="submit"
              variant="primary"
              disabled={createMutation.isPending}
            >
              Create namespace
            </Button>
          </form>
          {formError !== undefined ? (
            <p className="error-inline" role="alert">
              {formError}
            </p>
          ) : null}
        </SectionPanel>
      ) : null}

      {initialLoading ? (
        <LoadingBlock label="Loading memory namespaces…" />
      ) : null}
      {namespacesQuery.isError ? (
        <ErrorState
          title="Failed to load memory namespaces"
          error={namespacesQuery.error}
        />
      ) : null}

      {namespacesQuery.data !== undefined ? (
        <SectionPanel title="Namespaces">
          {namespacesQuery.data.items.length === 0 ? (
            <EmptyState
              title="No memory namespaces yet"
              description="Create a namespace, then bind it in Agent Studio with READ_ONLY or READ_WRITE access."
            />
          ) : (
            <DataTableRegion caption="Workspace memory namespaces">
              <thead>
                <tr>
                  <th scope="col">Name</th>
                  <th scope="col">Description</th>
                  <th scope="col">Created</th>
                  <th scope="col">Key</th>
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
                    <td>{namespace.description ?? "—"}</td>
                    <td>{new Date(namespace.createdAt).toLocaleString()}</td>
                    <td>
                      <details className="memory-v2-tech-details">
                        <summary>Show key</summary>
                        <span className="mono">{namespace.key}</span>
                      </details>
                    </td>
                  </tr>
                ))}
              </tbody>
            </DataTableRegion>
          )}
        </SectionPanel>
      ) : null}
    </div>
  );
}
