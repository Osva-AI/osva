import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";

import { EmptyState } from "../components/empty-state/empty-state";
import { ErrorState } from "../components/error-state/error-state";
import { LoadingBlock } from "../components/loading/loading-block";
import {
  useCreateKnowledgeSourceMutation,
  useKnowledgeSourcesQuery,
} from "../hooks/use-knowledge-memory";
import { useAuth } from "../context/auth-context";
import { consoleFetch } from "../lib/console-api";
import { roleCanWriteControlPlaneResources } from "../lib/permissions";
import { useWorkspaceQueryScope } from "../hooks/use-workspace-query-scope";

export function KnowledgePage() {
  const navigate = useNavigate();
  const auth = useAuth();
  const role = auth.selectedWorkspace?.role;
  const canWrite =
    role !== undefined && roleCanWriteControlPlaneResources(role);
  const sourcesQuery = useKnowledgeSourcesQuery({ limit: 50 });
  const createMutation = useCreateKnowledgeSourceMutation();
  const workspaceId = useWorkspaceQueryScope();

  const artifactsQuery = useQuery({
    queryKey: ["artifacts", workspaceId, "list"],
    enabled: workspaceId !== undefined,
    queryFn: () =>
      consoleFetch<{
        items: Array<{ id: string; name: string; mediaType: string }>;
      }>("/api/v1/artifacts?limit=50"),
  });

  const [key, setKey] = useState("");
  const [name, setName] = useState("");
  const [artifactId, setArtifactId] = useState("");
  const [formError, setFormError] = useState<string | undefined>();

  async function handleCreate(event: FormEvent): Promise<void> {
    event.preventDefault();
    setFormError(undefined);
    if (!canWrite) {
      setFormError("Your role cannot create knowledge sources.");
      return;
    }
    try {
      const created = await createMutation.mutateAsync({
        key: key.trim(),
        name: name.trim(),
        artifactId: artifactId.trim(),
      });
      setKey("");
      setName("");
      setArtifactId("");
      navigate(`/knowledge/sources/${encodeURIComponent(created.id)}`);
    } catch (error) {
      setFormError(
        error instanceof Error ? error.message : "Failed to create source.",
      );
    }
  }

  return (
    <>
      <header className="page-header">
        <div>
          <h1 className="page-title">Knowledge</h1>
          <p className="page-subtitle">
            Register document artifacts as knowledge sources, index them for
            semantic retrieval, and bind READY indexes to agents. Supported
            parsers include plain text, Markdown, and PDF (via the indexing
            worker). Sources reference existing workspace artifacts — upload
            artifacts through the control plane API if needed.
          </p>
        </div>
        <div className="toolbar">
          <button
            type="button"
            className="button"
            onClick={() => void sourcesQuery.refetch()}
          >
            Refresh
          </button>
        </div>
      </header>

      {canWrite ? (
        <section className="panel">
          <h2 className="section-title">Create source</h2>
          <form
            className="filters"
            onSubmit={(event) => void handleCreate(event)}
          >
            <div className="field">
              <label htmlFor="ks-key">Key</label>
              <input
                id="ks-key"
                value={key}
                onChange={(event) => setKey(event.target.value)}
                required
              />
            </div>
            <div className="field">
              <label htmlFor="ks-name">Name</label>
              <input
                id="ks-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                required
              />
            </div>
            <div className="field">
              <label htmlFor="ks-artifact">Artifact ID</label>
              <input
                id="ks-artifact"
                className="mono"
                value={artifactId}
                onChange={(event) => setArtifactId(event.target.value)}
                required
              />
              <p className="muted">
                Pick an existing workspace artifact or paste an ID from a prior
                upload.
              </p>
              {artifactsQuery.data?.items !== undefined &&
              artifactsQuery.data.items.length > 0 ? (
                <select
                  aria-label="Recent artifacts"
                  value=""
                  onChange={(event) => {
                    if (event.target.value.length > 0) {
                      setArtifactId(event.target.value);
                    }
                  }}
                >
                  <option value="">Select recent artifact…</option>
                  {artifactsQuery.data.items.map((artifact) => (
                    <option key={artifact.id} value={artifact.id}>
                      {artifact.name} ({artifact.mediaType})
                    </option>
                  ))}
                </select>
              ) : null}
            </div>
            <button
              type="submit"
              className="button primary"
              disabled={createMutation.isPending}
            >
              Create source
            </button>
          </form>
          {formError !== undefined ? (
            <p className="error-inline" role="alert">
              {formError}
            </p>
          ) : null}
          <p className="muted">
            Indexing runs asynchronously in the knowledge worker. Ensure the
            worker, embedding provider, and vector store are operational before
            expecting READY status.
          </p>
        </section>
      ) : (
        <p className="muted">Viewer role: knowledge sources are read-only.</p>
      )}

      {sourcesQuery.isLoading ? (
        <LoadingBlock label="Loading knowledge sources…" />
      ) : null}
      {sourcesQuery.isError ? (
        <ErrorState
          title="Failed to load knowledge sources"
          error={sourcesQuery.error}
        />
      ) : null}

      {sourcesQuery.data !== undefined ? (
        <section className="panel">
          {sourcesQuery.data.items.length === 0 ? (
            <EmptyState
              title="No knowledge sources yet."
              description="Create a source pointing at a workspace artifact, then create an index on the source detail page."
            />
          ) : (
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Key</th>
                    <th>Artifact</th>
                    <th>Created</th>
                  </tr>
                </thead>
                <tbody>
                  {sourcesQuery.data.items.map((source) => (
                    <tr key={source.id}>
                      <td>
                        <Link
                          to={`/knowledge/sources/${encodeURIComponent(source.id)}`}
                        >
                          {source.name}
                        </Link>
                      </td>
                      <td className="mono">{source.key}</td>
                      <td className="mono">{source.artifactId}</td>
                      <td>{new Date(source.createdAt).toLocaleString()}</td>
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
