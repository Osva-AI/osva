import { Link } from "react-router-dom";

import { homeAttentionStatusLabel } from "../../lib/home-attention-display";
import {
  attentionKindLabel,
  type AttentionItem,
} from "../../lib/overview-attention";
import { formatTimestamp } from "../../lib/formatting";

function attentionHeadline(item: AttentionItem): string {
  if (item.attentionKind === "failed") {
    return item.kind === "run"
      ? "An agent run needs review"
      : "A workflow run needs review";
  }
  if (item.attentionKind === "waiting") {
    return "A workflow is waiting for input";
  }
  return item.kind === "run"
    ? "An agent run is in progress"
    : "A workflow run is in progress";
}

function attentionDetail(item: AttentionItem): string {
  if (item.attentionKind === "failed") {
    return "Open the run details to see what happened and what you can do next.";
  }
  if (item.attentionKind === "waiting") {
    return "Check the workflow run for the step that is paused.";
  }
  return "You can monitor progress from the run detail page.";
}

export function HomeV2Attention({
  attentionItems,
}: {
  readonly attentionItems: readonly AttentionItem[];
}) {
  const actionable = attentionItems.filter(
    (item) =>
      item.attentionKind === "failed" || item.attentionKind === "waiting",
  );

  if (actionable.length === 0) {
    return null;
  }

  return (
    <section
      className="home-v2-attention"
      aria-labelledby="home-v2-attention-title"
    >
      <h2 id="home-v2-attention-title" className="home-v2-section-title">
        Needs attention
      </h2>
      <ul className="home-v2-attention-list">
        {actionable.slice(0, 3).map((item) => {
          const href =
            item.kind === "run"
              ? `/runs/${encodeURIComponent(item.id)}`
              : `/workflow-runs/${encodeURIComponent(item.id)}`;
          return (
            <li
              key={`${item.kind}-${item.id}`}
              className="home-v2-attention-item"
            >
              <div>
                <p className="home-v2-attention-headline">
                  {attentionHeadline(item)}
                </p>
                <p className="muted home-v2-attention-detail">
                  {attentionDetail(item)}{" "}
                  {homeAttentionStatusLabel(item.status)} ·{" "}
                  {attentionKindLabel(item.attentionKind)} ·{" "}
                  {formatTimestamp(item.updatedAt)}
                </p>
              </div>
              <Link className="button button-secondary" to={href}>
                Review run
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
