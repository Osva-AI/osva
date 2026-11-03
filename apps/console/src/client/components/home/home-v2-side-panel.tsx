import { Link } from "react-router-dom";

import type { HomeSideContext } from "../../lib/home-v2-side-context";
import { homeAttentionStatusLabel } from "../../lib/home-attention-display";
import {
  attentionKindLabel,
  type AttentionItem,
} from "../../lib/overview-attention";

function attentionHref(item: AttentionItem): string {
  return item.kind === "run"
    ? `/runs/${encodeURIComponent(item.id)}`
    : `/workflow-runs/${encodeURIComponent(item.id)}`;
}

function attentionTitle(item: AttentionItem): string {
  if (item.attentionKind === "failed") {
    return "A recent run didn't finish";
  }
  if (item.attentionKind === "waiting") {
    return "A workflow is waiting for input";
  }
  return "A run is in progress";
}

export function HomeV2SidePanel({ side }: { readonly side: HomeSideContext }) {
  const { resource, attentionItem } = side;
  if (resource === undefined && attentionItem === undefined) {
    return null;
  }

  return (
    <aside className="home-v2-secondary-work">
      {resource !== undefined ? (
        <>
          <p className="home-v2-card-overline">
            {resource.kind === "agent" ? "Your agent" : "Your workflow"}
          </p>
          <h3 className="home-v2-side-title">{resource.name}</h3>
          <p className="home-v2-side-lead muted">{resource.detail}</p>
          <Link className="home-v2-side-link" to={resource.href}>
            {resource.linkLabel}
          </Link>
        </>
      ) : null}
      {attentionItem !== undefined ? (
        <div className="home-v2-attention-inline">
          <p className="home-v2-attention-inline-title">
            {attentionTitle(attentionItem)}
          </p>
          <p className="muted home-v2-attention-inline-detail">
            Open the run to see what happened and what to try next.{" "}
            {attentionKindLabel(attentionItem.attentionKind)} ·{" "}
            {homeAttentionStatusLabel(attentionItem.status)}
          </p>
          <Link className="home-v2-side-link" to={attentionHref(attentionItem)}>
            Review run
          </Link>
        </div>
      ) : null}
    </aside>
  );
}
