import { Link } from "react-router-dom";

import type { OfficeActivityEntry } from "@osva/domain/office-activity";
import { officeActivityTypeLabel } from "@osva/domain/office-activity";

import { formatActivityTimestamp } from "../../lib/formatting";
import { runStatusCategory } from "../../lib/statuses";
import { StatusChip } from "../status/status-chip";
export function OfficeActivityFeedList(props: {
  readonly entries: readonly OfficeActivityEntry[];
  readonly goalsById: ReadonlyMap<string, string>;
  readonly workersById: ReadonlyMap<string, string>;
  readonly assignmentsById: ReadonlyMap<
    string,
    { readonly title: string; readonly status: string }
  >;
  readonly testId?: string;
}) {
  if (props.entries.length === 0) {
    return (
      <p className="muted" data-testid="office-activity-feed-empty">
        No matching activity entries.
      </p>
    );
  }

  return (
    <ul
      className="home-v2-activity-list"
      data-testid={props.testId ?? "office-activity-feed"}
    >
      {props.entries.map((entry) => {
        const missionTitle =
          entry.goalId !== undefined
            ? props.goalsById.get(entry.goalId)
            : undefined;
        const workerName =
          entry.officeWorkerId !== undefined
            ? props.workersById.get(entry.officeWorkerId)
            : undefined;
        const assignment =
          entry.assignmentId !== undefined
            ? props.assignmentsById.get(entry.assignmentId)
            : undefined;

        return (
          <li
            key={entry.id}
            className="home-v2-activity-row activity-v2-feed-row"
            data-testid={`office-activity-row-${entry.id}`}
          >
            <div className="activity-v2-row-link office-activity-row">
              <div className="activity-v2-row-leading">
                <span className="activity-v2-row-title">
                  {officeActivityTypeLabel(entry.activityType)}
                </span>
                <span className="muted activity-v2-row-meta-line">
                  {entry.assignmentId !== undefined &&
                  assignment !== undefined ? (
                    <>
                      Task{" "}
                      <Link to={`/office/tasks/${entry.assignmentId}`}>
                        {assignment.title}
                      </Link>
                    </>
                  ) : entry.assignmentTitle !== undefined ? (
                    <span>{entry.assignmentTitle}</span>
                  ) : null}
                  {entry.workflowNodeKey !== undefined ? (
                    <span className="mono"> · {entry.workflowNodeKey}</span>
                  ) : null}
                </span>
              </div>
              <div className="activity-v2-row-trailing">
                {entry.executionStatus !== undefined ? (
                  <StatusChip
                    status={entry.executionStatus}
                    category={runStatusCategory(entry.executionStatus)}
                    label={entry.executionStatus}
                  />
                ) : null}
                <time
                  className="muted activity-v2-row-time"
                  dateTime={entry.occurredAt}
                >
                  {entry.occurredAt === undefined
                    ? "Time unavailable"
                    : formatActivityTimestamp(entry.occurredAt)}
                </time>
                <Link to={entry.navigation.href} className="text-link">
                  View source
                </Link>
              </div>
              <p className="muted office-activity-row-context">
                {entry.goalId !== undefined ? (
                  <>
                    Mission{" "}
                    {missionTitle !== undefined ? (
                      <Link to={`/office/missions/${entry.goalId}`}>
                        {missionTitle}
                      </Link>
                    ) : (
                      <span className="mono">{entry.goalId}</span>
                    )}
                    {" · "}
                  </>
                ) : null}
                {entry.officeWorkerId !== undefined ? (
                  <>
                    Worker{" "}
                    {workerName !== undefined ? (
                      <Link to={`/office/workers/${entry.officeWorkerId}`}>
                        {workerName}
                      </Link>
                    ) : (
                      <span className="mono">{entry.officeWorkerId}</span>
                    )}
                  </>
                ) : null}
              </p>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
