import { Link } from "react-router-dom";

import {
  attentionKindLabel,
  type AttentionItem,
} from "../../lib/overview-attention";
import { formatTimestamp } from "../../lib/formatting";
import {
  runStatusCategory,
  workflowRunStatusCategory,
} from "../../lib/statuses";
import { EmptyState } from "../empty-state/empty-state";
import { StatusChip } from "../status/status-chip";
import { SectionPanel } from "../ui/section-panel";
import { HOME_RECENT_LIMIT } from "../../hooks/use-home-page-data";

export function HomeAttentionPanel({
  attentionItems,
}: {
  readonly attentionItems: readonly AttentionItem[];
}) {
  return (
    <SectionPanel
      title="Needs attention"
      description={`Signals from the ${String(HOME_RECENT_LIMIT)} most recent agent and workflow runs loaded—not a complete workspace audit.`}
    >
      {attentionItems.length === 0 ? (
        <EmptyState
          title="Nothing flagged in recent runs"
          description="Failed, waiting, or in-progress items appear here when present in the latest loaded run pages."
        />
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>Kind</th>
              <th>Resource</th>
              <th>Status</th>
              <th>Signal</th>
              <th>Updated</th>
            </tr>
          </thead>
          <tbody>
            {attentionItems.map((item) => (
              <tr key={`${item.kind}-${item.id}`}>
                <td>{item.kind === "run" ? "Run" : "Workflow run"}</td>
                <td>
                  <Link
                    className="mono"
                    to={
                      item.kind === "run"
                        ? `/runs/${encodeURIComponent(item.id)}`
                        : `/workflow-runs/${encodeURIComponent(item.id)}`
                    }
                  >
                    {item.id}
                  </Link>
                  <div className="muted mono home-attention-secondary">
                    {item.kind === "run" ? item.agentId : item.workflowId}
                  </div>
                </td>
                <td>
                  <StatusChip
                    status={item.status}
                    category={
                      item.kind === "run"
                        ? runStatusCategory(item.status)
                        : workflowRunStatusCategory(item.status)
                    }
                  />
                </td>
                <td>{attentionKindLabel(item.attentionKind)}</td>
                <td>{formatTimestamp(item.updatedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </SectionPanel>
  );
}
