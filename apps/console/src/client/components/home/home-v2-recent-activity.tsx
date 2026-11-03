import { Link } from "react-router-dom";

import type { HomePageData } from "../../hooks/use-home-page-data";
import { formatTimestamp } from "../../lib/formatting";
import {
  runStatusCategory,
  workflowRunStatusCategory,
} from "../../lib/statuses";
import { StatusChip } from "../status/status-chip";

interface ActivityRow {
  readonly id: string;
  readonly kind: "agent" | "workflow";
  readonly label: string;
  readonly href: string;
  readonly status: string;
  readonly updatedAt: string;
  readonly statusCategory: ReturnType<typeof runStatusCategory>;
}

function buildActivityRows(data: HomePageData): readonly ActivityRow[] {
  const rows: ActivityRow[] = [];
  for (const run of data.recentRuns) {
    rows.push({
      id: run.id,
      kind: "agent",
      label: "Agent run",
      href: `/runs/${encodeURIComponent(run.id)}`,
      status: run.status,
      updatedAt: run.updatedAt,
      statusCategory: runStatusCategory(run.status),
    });
  }
  for (const run of data.recentWorkflowRuns) {
    rows.push({
      id: run.id,
      kind: "workflow",
      label: "Workflow run",
      href: `/workflow-runs/${encodeURIComponent(run.id)}`,
      status: run.status,
      updatedAt: run.updatedAt,
      statusCategory: workflowRunStatusCategory(run.status),
    });
  }
  return rows
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
    .slice(0, 6);
}

export function HomeV2RecentActivity({
  data,
}: {
  readonly data: HomePageData;
}) {
  const rows = buildActivityRows(data);
  const runsFailed = data.recentRunsQuery.isError;
  const workflowRunsFailed = data.recentWorkflowRunsQuery.isError;

  if (runsFailed && workflowRunsFailed) {
    return (
      <section
        className="home-v2-activity"
        aria-labelledby="home-v2-activity-title"
      >
        <h2 id="home-v2-activity-title" className="home-v2-section-title">
          Recent activity
        </h2>
        <p className="muted">
          Activity could not be loaded. Use Retry on the banner above or open{" "}
          <Link to="/activity">Activity</Link>.
        </p>
      </section>
    );
  }

  if (rows.length === 0) {
    return null;
  }

  return (
    <section
      className="home-v2-activity"
      aria-labelledby="home-v2-activity-title"
    >
      <div className="home-v2-section-head">
        <h2 id="home-v2-activity-title" className="home-v2-section-title">
          Recent activity
        </h2>
        <Link className="home-v2-text-link" to="/activity">
          View all activity
        </Link>
      </div>
      <ul className="home-v2-activity-list">
        {rows.map((row) => (
          <li key={`${row.kind}-${row.id}`} className="home-v2-activity-row">
            <div>
              <Link to={row.href}>{row.label}</Link>
              <p className="muted home-v2-activity-meta">{row.id}</p>
            </div>
            <div className="home-v2-activity-status">
              <StatusChip status={row.status} category={row.statusCategory} />
              <span className="muted">{formatTimestamp(row.updatedAt)}</span>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
