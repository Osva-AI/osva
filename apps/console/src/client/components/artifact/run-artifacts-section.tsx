import { useEffect } from "react";
import { Link } from "react-router-dom";

import { useArtifactPreview } from "../../hooks/use-artifact-preview";
import type { ArtifactResource } from "../../hooks/use-runs";
import {
  artifactContentPath,
  classifyArtifactPreview,
} from "../../lib/artifact-preview";
import { formatBytes, formatTimestamp } from "../../lib/formatting";
import type { WorkflowArtifactAssociation } from "../../lib/workflow-artifacts";
import { EmptyState } from "../empty-state/empty-state";
import { ErrorState } from "../error-state/error-state";
import { JsonView } from "../json-view/json-view";
import { LoadingBlock } from "../loading/loading-block";
import { ArtifactPreviewPanel } from "./artifact-preview-panel";

interface RunArtifactsSectionProps {
  readonly artifacts: readonly ArtifactResource[] | undefined;
  readonly isLoading: boolean;
  readonly isError: boolean;
  readonly error: unknown;
  readonly live: boolean;
  readonly associations?: Readonly<Record<string, WorkflowArtifactAssociation>>;
  readonly truncated?: boolean;
  readonly failures?: readonly string[];
}

export function RunArtifactsSection({
  artifacts,
  isLoading,
  isError,
  error,
  live,
  associations,
  truncated = false,
  failures = [],
}: RunArtifactsSectionProps) {
  const preview = useArtifactPreview();
  const selected = artifacts?.find((item) => item.id === preview.selectedId);
  const workflowView = associations !== undefined;

  useEffect(() => {
    if (
      preview.selectedId !== undefined &&
      artifacts !== undefined &&
      !artifacts.some((item) => item.id === preview.selectedId)
    ) {
      preview.close();
    }
  }, [artifacts, preview.close, preview.selectedId]);

  return (
    <section className="panel">
      <h2 className="panel-title">Related artifacts</h2>
      {isLoading ? <LoadingBlock label="Loading artifacts…" /> : null}
      {isError ? (
        <ErrorState title="Failed to load artifacts" error={error} />
      ) : null}
      {failures.length > 0 ? (
        <ErrorState
          title="Some artifact lists could not be loaded"
          error={new Error(failures.join(" "))}
        />
      ) : null}
      {truncated ? (
        <p className="muted" role="status">
          Showing a bounded page of artifacts. Additional results were not
          loaded.
        </p>
      ) : null}
      {artifacts?.length === 0 && failures.length === 0 ? (
        <EmptyState
          title={live ? "No artifacts produced yet." : "No artifacts produced."}
          description={
            live
              ? workflowView
                ? "They will appear here when agent child runs publish them."
                : "They will appear here when the run publishes them."
              : undefined
          }
        />
      ) : null}
      {artifacts !== undefined && artifacts.length > 0 ? (
        <div className="artifact-table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Media type</th>
                <th>Size</th>
                {workflowView ? null : <th>Digest</th>}
                <th>Created</th>
                {workflowView ? (
                  <>
                    <th>Node</th>
                    <th>Child Run</th>
                  </>
                ) : (
                  <th>Producer</th>
                )}
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {artifacts.map((artifact) => (
                <ArtifactRow
                  key={artifact.id}
                  artifact={artifact}
                  selected={preview.selectedId === artifact.id}
                  association={associations?.[artifact.id]}
                  onPreview={() => preview.open(artifact)}
                />
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {selected !== undefined && preview.status !== "closed" ? (
        <ArtifactPreviewPanel
          artifact={selected}
          status={preview.status}
          text={preview.text}
          error={preview.error}
          onClose={preview.close}
        />
      ) : null}
    </section>
  );
}

function ArtifactRow({
  artifact,
  selected,
  association,
  onPreview,
}: {
  readonly artifact: ArtifactResource;
  readonly selected: boolean;
  readonly association?: WorkflowArtifactAssociation;
  readonly onPreview: () => void;
}) {
  const capability = classifyArtifactPreview(artifact);
  const canRequestPreview = capability === "text" || capability === "json";
  const workflowView = association !== undefined;

  return (
    <tr className={selected ? "artifact-row-selected" : undefined}>
      <td>
        <div className="artifact-name">{artifact.name}</div>
        {artifact.metadata !== undefined &&
        Object.keys(artifact.metadata).length > 0 ? (
          <details>
            <summary>Metadata</summary>
            <JsonView label="Metadata" value={artifact.metadata} />
          </details>
        ) : null}
      </td>
      <td className="mono">{artifact.mediaType}</td>
      <td>{formatBytes(artifact.sizeBytes)}</td>
      {workflowView ? null : (
        <td>
          <span className="mono artifact-digest" title={artifact.digest}>
            {artifact.digest}
          </span>
        </td>
      )}
      <td>{formatTimestamp(artifact.createdAt)}</td>
      {workflowView ? (
        <>
          <td className="mono">{association.nodeKey}</td>
          <td className="mono">
            <Link to={`/runs/${association.childRunId}`}>
              {association.childRunId}
            </Link>
          </td>
        </>
      ) : (
        <td className="mono">
          {artifact.producer !== undefined ? (
            <>
              <Link to={`/runs/${artifact.producer.runId}`}>
                {artifact.producer.runId}
              </Link>
              {" / "}
              {artifact.producer.runAttemptId}
            </>
          ) : (
            "—"
          )}
        </td>
      )}
      <td>
        <div className="toolbar artifact-actions">
          {canRequestPreview ? (
            <button
              type="button"
              className="button"
              onClick={onPreview}
              aria-label={`Preview ${artifact.name}`}
              aria-pressed={selected}
            >
              Preview
            </button>
          ) : (
            <button
              type="button"
              className="button"
              onClick={onPreview}
              aria-label={`Why ${artifact.name} cannot be previewed`}
              aria-pressed={selected}
            >
              Preview unavailable
            </button>
          )}
          <a
            className="button"
            href={artifactContentPath(artifact.id)}
            download={artifact.name}
            aria-label={`Download ${artifact.name}`}
          >
            Download
          </a>
        </div>
      </td>
    </tr>
  );
}
