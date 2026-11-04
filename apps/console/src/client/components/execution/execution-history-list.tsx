import { Link } from "react-router-dom";

import type { ActivityFeedRow } from "../../lib/activity-feed";
import { formatActivityTimestamp } from "../../lib/formatting";
import { StatusChip } from "../status/status-chip";

export interface ExecutionHistoryListRow extends ActivityFeedRow {
  readonly contextLabel: string;
  readonly rowClassName?: string;
  readonly waitingHint?: string;
}

interface ExecutionHistoryListProps {
  readonly rows: readonly ExecutionHistoryListRow[];
  readonly listTestId: string;
  readonly ariaLabel: string;
}

export function ExecutionHistoryList({
  rows,
  listTestId,
  ariaLabel,
}: ExecutionHistoryListProps) {
  return (
    <section
      className="execution-history-v2-feed home-v2-activity panel"
      aria-label={ariaLabel}
      data-testid={listTestId}
    >
      <ul className="home-v2-activity-list">
        {rows.map((row) => {
          const showUpdated = row.updatedAt !== row.createdAt;
          return (
            <li
              key={row.id}
              className={`home-v2-activity-row activity-v2-feed-row execution-history-v2-row${row.rowClassName !== undefined ? ` ${row.rowClassName}` : ""}`}
            >
              <Link
                to={row.href}
                className="activity-v2-row-link"
                aria-label={`${row.title}, ${row.statusLabel}, ${row.contextLabel}, created ${formatActivityTimestamp(row.createdAt)}`}
              >
                <div className="activity-v2-row-leading">
                  <span className="activity-v2-row-title">{row.title}</span>
                  <span className="muted activity-v2-row-meta-line">
                    <span className="activity-v2-type">
                      {row.kind === "agent" ? "Agent" : "Workflow"}
                    </span>
                    <span className="mono activity-v2-row-id" title={row.id}>
                      {row.shortId}
                    </span>
                  </span>
                  <span className="muted execution-history-v2-context">
                    {row.contextLabel}
                  </span>
                  {row.waitingHint !== undefined ? (
                    <span
                      className="execution-history-v2-waiting-hint"
                      role="status"
                    >
                      {row.waitingHint}
                    </span>
                  ) : null}
                </div>
                <div className="activity-v2-row-trailing">
                  <StatusChip
                    status={row.status}
                    category={row.statusCategory}
                    label={row.statusLabel}
                  />
                  <time
                    className="muted activity-v2-row-time"
                    dateTime={row.createdAt}
                  >
                    Created {formatActivityTimestamp(row.createdAt)}
                  </time>
                  {showUpdated ? (
                    <span className="muted activity-v2-row-time">
                      Updated {formatActivityTimestamp(row.updatedAt)}
                    </span>
                  ) : null}
                </div>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

interface ExecutionHistoryPaginationProps {
  readonly canGoPrevious: boolean;
  readonly canGoNext: boolean;
  readonly onPrevious: () => void;
  readonly onNext: () => void;
  readonly isFetching?: boolean;
}

export function ExecutionHistoryPagination({
  canGoPrevious,
  canGoNext,
  onPrevious,
  onNext,
  isFetching = false,
}: ExecutionHistoryPaginationProps) {
  return (
    <nav
      className="execution-history-v2-pagination toolbar"
      aria-label="History pages"
      data-testid="execution-history-pagination"
    >
      <button
        type="button"
        className="button"
        disabled={!canGoPrevious || isFetching}
        onClick={onPrevious}
      >
        Previous
      </button>
      <button
        type="button"
        className="button"
        disabled={!canGoNext || isFetching}
        onClick={onNext}
      >
        Next
      </button>
    </nav>
  );
}
