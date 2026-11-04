import {
  formatKnowledgeIndexStatusLabel,
  knowledgeIndexStatusTone,
} from "../../lib/knowledge-resource-presentation";

function statusChipClass(
  tone: ReturnType<typeof knowledgeIndexStatusTone>,
): string {
  if (tone === "warning") {
    return "status-inactive";
  }
  return `status-${tone}`;
}

export function KnowledgeIndexStatus(props: { readonly status: string }) {
  const tone = knowledgeIndexStatusTone(props.status);
  return (
    <span className={`status-chip ${statusChipClass(tone)}`}>
      <span className="status-dot" aria-hidden="true" />
      {formatKnowledgeIndexStatusLabel(props.status)}
    </span>
  );
}
