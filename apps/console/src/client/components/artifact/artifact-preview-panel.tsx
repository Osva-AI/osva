import { ConsoleApiError } from "../../lib/console-api";
import {
  classifyArtifactPreview,
  describePreviewUnavailable,
  parseJsonPreview,
  previewErrorMessage,
} from "../../lib/artifact-preview";
import type { ArtifactPreviewStatus } from "../../hooks/use-artifact-preview";
import type { ArtifactResource } from "../../hooks/use-runs";
import { ErrorState } from "../error-state/error-state";
import { JsonView } from "../json-view/json-view";
import { LoadingBlock } from "../loading/loading-block";

interface ArtifactPreviewPanelProps {
  readonly artifact: ArtifactResource;
  readonly status: ArtifactPreviewStatus;
  readonly text: string | undefined;
  readonly error: unknown;
  readonly onClose: () => void;
}

export function ArtifactPreviewPanel({
  artifact,
  status,
  text,
  error,
  onClose,
}: ArtifactPreviewPanelProps) {
  const capability = classifyArtifactPreview(artifact);
  const unavailable = describePreviewUnavailable(capability);

  return (
    <div
      className="artifact-preview-panel"
      data-testid="artifact-preview-panel"
    >
      <div className="toolbar" style={{ justifyContent: "space-between" }}>
        <strong>
          Preview <span className="mono">{artifact.name}</span>
        </strong>
        <button
          type="button"
          className="button"
          onClick={onClose}
          aria-label={`Close preview of ${artifact.name}`}
        >
          Close preview
        </button>
      </div>

      {status === "loading" ? <LoadingBlock label="Loading preview…" /> : null}

      {status === "blocked" && unavailable !== undefined ? (
        <p className="muted">{unavailable}</p>
      ) : null}

      {status === "error" ? (
        <ErrorState
          title="Failed to load preview"
          error={toPreviewError(error)}
        />
      ) : null}

      {status === "ready" && text !== undefined ? (
        <PreviewBody artifact={artifact} text={text} />
      ) : null}
    </div>
  );
}

function PreviewBody({
  artifact,
  text,
}: {
  readonly artifact: ArtifactResource;
  readonly text: string;
}) {
  const capability = classifyArtifactPreview(artifact);
  if (capability === "json") {
    const parsed = parseJsonPreview(text);
    if (parsed.ok) {
      return <JsonView label="JSON preview" value={parsed.value} />;
    }
    return (
      <div>
        <p className="muted">Content is not valid JSON. Showing raw text.</p>
        <div className="artifact-preview-body">
          <pre>{text}</pre>
        </div>
      </div>
    );
  }

  return (
    <div className="artifact-preview-body">
      <pre>{text}</pre>
    </div>
  );
}

function toPreviewError(error: unknown): Error {
  const message = previewErrorMessage(error);
  if (error instanceof ConsoleApiError) {
    return new ConsoleApiError(error.status, {
      ...error.body,
      error: message,
    });
  }
  return new Error(message);
}
