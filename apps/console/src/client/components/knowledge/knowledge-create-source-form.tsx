import { useMemo, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";

import { ErrorState } from "../error-state/error-state";
import { Button } from "../ui/button";
import { TextField } from "../ui/field";
import { SectionPanel } from "../ui/section-panel";
import { useCreateKnowledgeSourceMutation } from "../../hooks/use-knowledge-memory";
import { consoleFetch } from "../../lib/console-api";
import { formatArtifactPickerLabel } from "../../lib/knowledge-resource-presentation";
import { useWorkspaceQueryScope } from "../../hooks/use-workspace-query-scope";

type CreateStep = "artifact" | "details" | "review";

export function KnowledgeCreateSourceForm() {
  const navigate = useNavigate();
  const workspaceId = useWorkspaceQueryScope();
  const createMutation = useCreateKnowledgeSourceMutation();

  const artifactsQuery = useQuery({
    queryKey: ["artifacts", workspaceId, "list"],
    enabled: workspaceId !== undefined,
    queryFn: () =>
      consoleFetch<{
        items: Array<{ id: string; name: string; mediaType: string }>;
      }>("/api/v1/artifacts?limit=50"),
  });

  const [step, setStep] = useState<CreateStep>("artifact");
  const [artifactFilter, setArtifactFilter] = useState("");
  const [artifactId, setArtifactId] = useState("");
  const [key, setKey] = useState("");
  const [name, setName] = useState("");
  const [formError, setFormError] = useState<string | undefined>();

  const artifacts = artifactsQuery.data?.items ?? [];
  const filteredArtifacts = useMemo(() => {
    const needle = artifactFilter.trim().toLowerCase();
    if (needle.length === 0) {
      return artifacts;
    }
    return artifacts.filter(
      (artifact) =>
        artifact.name.toLowerCase().includes(needle) ||
        artifact.mediaType.toLowerCase().includes(needle) ||
        artifact.id.toLowerCase().includes(needle),
    );
  }, [artifactFilter, artifacts]);

  const selectedArtifact = artifacts.find(
    (artifact) => artifact.id === artifactId,
  );

  async function handleCreate(event: FormEvent): Promise<void> {
    event.preventDefault();
    setFormError(undefined);
    try {
      const created = await createMutation.mutateAsync({
        key: key.trim(),
        name: name.trim(),
        artifactId: artifactId.trim(),
      });
      navigate(`/knowledge/sources/${encodeURIComponent(created.id)}`);
    } catch (error) {
      setFormError(
        error instanceof Error ? error.message : "Failed to create source.",
      );
    }
  }

  return (
    <SectionPanel
      title="Create knowledge source"
      description="Pick a workspace artifact, name the source, then create an index on the detail page."
    >
      <ol className="knowledge-v2-create-steps" aria-label="Creation steps">
        <li className={step === "artifact" ? "is-active" : undefined}>
          1. Artifact
        </li>
        <li className={step === "details" ? "is-active" : undefined}>
          2. Name & key
        </li>
        <li className={step === "review" ? "is-active" : undefined}>
          3. Review
        </li>
      </ol>

      {step === "artifact" ? (
        <div className="knowledge-v2-create-step stack">
          <TextField
            label="Filter artifacts"
            value={artifactFilter}
            onChange={(event) => setArtifactFilter(event.target.value)}
            hint="Search by name, media type, or ID."
          />
          {artifactsQuery.isLoading ? (
            <p className="muted" role="status">
              Loading artifacts…
            </p>
          ) : null}
          {artifactsQuery.isError ? (
            <ErrorState
              title="Failed to load workspace artifacts"
              error={artifactsQuery.error}
            />
          ) : null}
          {artifacts.length === 0 &&
          !artifactsQuery.isLoading &&
          !artifactsQuery.isError ? (
            <p className="muted" role="status">
              No artifacts in this workspace. Upload via the control plane API,
              then refresh.
            </p>
          ) : null}
          {filteredArtifacts.length > 0 ? (
            <div className="field">
              <label htmlFor="ks-artifact-select">Workspace artifact</label>
              <select
                id="ks-artifact-select"
                value={artifactId}
                onChange={(event) => setArtifactId(event.target.value)}
                required={artifactId.length === 0}
              >
                <option value="">Select artifact…</option>
                {filteredArtifacts.map((artifact) => (
                  <option key={artifact.id} value={artifact.id}>
                    {formatArtifactPickerLabel(artifact)}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
          <details className="knowledge-v2-tech-details">
            <summary>Advanced: paste artifact ID</summary>
            <TextField
              id="ks-artifact"
              label="Artifact ID"
              className="mono"
              value={artifactId}
              onChange={(event) => setArtifactId(event.target.value)}
            />
          </details>
          <div className="toolbar">
            <Button
              type="button"
              variant="primary"
              disabled={artifactId.trim().length === 0}
              onClick={() => setStep("details")}
            >
              Continue
            </Button>
          </div>
        </div>
      ) : null}

      {step === "details" ? (
        <form
          className="knowledge-v2-create-step stack"
          onSubmit={(event) => {
            event.preventDefault();
            setStep("review");
          }}
        >
          <TextField
            id="ks-name"
            label="Display name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            required
          />
          <TextField
            id="ks-key"
            label="Key"
            value={key}
            onChange={(event) => setKey(event.target.value)}
            hint="Stable identifier for APIs and bindings."
            required
          />
          <div className="toolbar">
            <Button type="button" onClick={() => setStep("artifact")}>
              Back
            </Button>
            <Button
              type="submit"
              variant="primary"
              disabled={key.trim().length === 0 || name.trim().length === 0}
            >
              Continue
            </Button>
          </div>
        </form>
      ) : null}

      {step === "review" ? (
        <form
          className="knowledge-v2-create-step stack"
          onSubmit={(event) => void handleCreate(event)}
        >
          <dl className="meta-grid">
            <div>
              <dt>Artifact</dt>
              <dd>
                {selectedArtifact !== undefined
                  ? formatArtifactPickerLabel(selectedArtifact)
                  : artifactId}
              </dd>
            </div>
            <div>
              <dt>Name</dt>
              <dd>{name}</dd>
            </div>
            <div>
              <dt>Key</dt>
              <dd className="mono">{key}</dd>
            </div>
          </dl>
          <div className="toolbar">
            <Button type="button" onClick={() => setStep("details")}>
              Back
            </Button>
            <Button
              type="submit"
              variant="primary"
              disabled={createMutation.isPending}
            >
              Create source
            </Button>
          </div>
        </form>
      ) : null}

      {formError !== undefined ? (
        <p className="error-inline" role="alert">
          {formError}
        </p>
      ) : null}
    </SectionPanel>
  );
}
