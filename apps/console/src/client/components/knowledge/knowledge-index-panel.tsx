import { OperatorGuidancePanel } from "../operator/operator-guidance";
import { Button } from "../ui/button";
import type { KnowledgeIndexResource } from "../../hooks/use-knowledge-memory";
import { describeKnowledgeIndexFailureGuidance } from "../../lib/operator-diagnostics";
import {
  formatKnowledgeIndexStatusLabel,
  summarizeKnowledgeIndexPipeline,
} from "../../lib/knowledge-resource-presentation";
import { KnowledgeIndexStatus } from "./knowledge-index-status";

export function KnowledgeIndexPanel(props: {
  readonly index: KnowledgeIndexResource;
  readonly canWrite: boolean;
  readonly onRetry: () => void;
  readonly retryPending: boolean;
}) {
  const { index } = props;
  const failureGuidance = describeKnowledgeIndexFailureGuidance({
    status: index.status,
    lastErrorCode: index.lastErrorCode,
    lastErrorMessage: index.lastErrorMessage,
  });

  return (
    <article className="knowledge-v2-index-card panel">
      <div className="knowledge-v2-index-card-header">
        <KnowledgeIndexStatus status={index.status} />
        <p className="muted knowledge-v2-index-created">
          Created {new Date(index.createdAt).toLocaleString()}
        </p>
      </div>

      <dl className="meta-grid knowledge-v2-index-meta">
        <div>
          <dt>Parser</dt>
          <dd>
            {index.parserKey}@{index.parserVersion}
          </dd>
        </div>
        <div>
          <dt>Chunker</dt>
          <dd>
            {index.chunkerKey}@{index.chunkerVersion}
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

      <details className="knowledge-v2-tech-details">
        <summary>Pipeline & identifiers</summary>
        <p className="muted">{summarizeKnowledgeIndexPipeline(index)}</p>
        <p className="mono knowledge-v2-id-line">Index ID: {index.id}</p>
        {index.pipelineFingerprint.length > 0 ? (
          <p className="mono knowledge-v2-id-line">
            Fingerprint: {index.pipelineFingerprint}
          </p>
        ) : null}
      </details>

      {index.lastErrorCode !== undefined ? (
        <p className="error-inline" role="alert">
          {index.lastErrorCode}
          {index.lastErrorMessage !== undefined
            ? `: ${index.lastErrorMessage}`
            : ""}
        </p>
      ) : null}
      {failureGuidance !== undefined ? (
        <OperatorGuidancePanel guidance={failureGuidance} />
      ) : null}

      {index.status === "FAILED" && props.canWrite ? (
        <Button
          type="button"
          disabled={props.retryPending}
          onClick={props.onRetry}
        >
          Retry indexing
        </Button>
      ) : null}
      {index.status !== "FAILED" && index.status !== "READY" ? (
        <p className="muted" role="status">
          Status {formatKnowledgeIndexStatusLabel(index.status)} — refresh to
          see worker updates. No progress percentage is available from the API.
        </p>
      ) : null}
    </article>
  );
}
