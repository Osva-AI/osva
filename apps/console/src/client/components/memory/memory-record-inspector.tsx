import { JsonView } from "../json-view/json-view";
import type { MemoryRecordResource } from "../../hooks/use-knowledge-memory";
import {
  memoryRecordValueKind,
  summarizeMemoryRecordPreview,
} from "../../lib/memory-resource-presentation";

export function MemoryRecordInspector(props: {
  readonly record: MemoryRecordResource;
}) {
  const { record } = props;
  const summary = summarizeMemoryRecordPreview(record.value);
  const kind = memoryRecordValueKind(record.value);

  return (
    <article className="memory-v2-record-card">
      <header className="memory-v2-record-header">
        <p className="memory-v2-record-key mono">{record.key}</p>
        <p className="muted memory-v2-record-revision">
          Revision {String(record.revision)} · {kind}
        </p>
      </header>
      <p className="memory-v2-value-preview mono" aria-label="Value preview">
        {summary.preview}
      </p>
      {summary.isTruncated ? (
        <p className="muted memory-v2-value-hint">
          Preview truncated ({String(summary.fullLength)} characters). Expand to
          inspect the full value — it may contain sensitive data.
        </p>
      ) : null}
      <details className="memory-v2-tech-details">
        <summary>View full value</summary>
        <JsonView value={record.value} label="Record JSON" />
      </details>
    </article>
  );
}
