import type { TaskExecutionSummary } from "@osva/domain/office-observability";

import {
  formatTerminalSuccessRatePercent,
  OFFICE_OBSERVABILITY_ASSIGNMENT_SCOPE_LABEL,
} from "../../lib/office-observability";
import { formatMeasuredDurationMs } from "../../lib/office-observability";

export function OfficeTaskMetricsPanel(props: {
  readonly summary: TaskExecutionSummary;
  readonly testId?: string;
  readonly scopeLabel?: string;
}) {
  const scope = props.scopeLabel ?? OFFICE_OBSERVABILITY_ASSIGNMENT_SCOPE_LABEL;
  const median =
    props.summary.duration.medianDurationMs !== undefined
      ? formatMeasuredDurationMs(props.summary.duration.medianDurationMs)
      : "—";

  return (
    <div
      className="overview-metrics office-observability-metrics"
      data-testid={props.testId ?? "office-task-metrics"}
    >
      <article className="metric-card">
        <p className="metric-label">Total tasks</p>
        <p className="metric-value">{props.summary.total}</p>
      </article>
      <article className="metric-card">
        <p className="metric-label">Active tasks</p>
        <p className="metric-value">{props.summary.active}</p>
        <p className="metric-detail muted">
          {props.summary.pending} pending · {props.summary.running} running
        </p>
      </article>
      <article className="metric-card">
        <p className="metric-label">Terminal success rate</p>
        <p className="metric-value">
          {formatTerminalSuccessRatePercent(props.summary)}
        </p>
        <p className="metric-detail muted">
          Completed / terminal outcomes ({props.summary.terminalDenominator}{" "}
          tasks). Cancelled tasks are in the denominator only.
        </p>
      </article>
      <article className="metric-card">
        <p className="metric-label">Completed</p>
        <p className="metric-value">{props.summary.completed}</p>
      </article>
      <article className="metric-card">
        <p className="metric-label">Failed</p>
        <p className="metric-value">{props.summary.failed}</p>
      </article>
      <article className="metric-card">
        <p className="metric-label">Cancelled</p>
        <p className="metric-value">{props.summary.cancelled}</p>
      </article>
      {props.summary.duration.measuredCount > 0 ? (
        <article className="metric-card">
          <p className="metric-label">Median measured duration</p>
          <p className="metric-value">{median}</p>
          <p className="metric-detail muted">
            {props.summary.duration.measuredCount} terminal tasks with start and
            end timestamps
          </p>
        </article>
      ) : null}
      <p className="muted office-observability-scope" role="note">
        {scope}
      </p>
    </div>
  );
}
