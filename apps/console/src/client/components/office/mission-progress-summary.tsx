import type { MissionProgressSnapshot } from "../../lib/mission-progress";

export function MissionProgressSummary(props: {
  readonly progress: MissionProgressSnapshot;
}) {
  const percent =
    props.progress.total === 0
      ? 0
      : Math.round(props.progress.completedRatio * 100);

  return (
    <div
      className="office-mission-progress"
      data-testid="mission-progress-summary"
    >
      <MissionProgressBar
        percent={percent}
        completed={props.progress.completed}
        total={props.progress.total}
      />
      <ul className="office-mission-progress-counts muted">
        <li>{props.progress.pending} pending</li>
        <li>{props.progress.running} running</li>
        <li>{props.progress.completed} completed</li>
        {props.progress.failed > 0 ? (
          <li>{props.progress.failed} failed</li>
        ) : null}
        {props.progress.cancelled > 0 ? (
          <li>{props.progress.cancelled} cancelled</li>
        ) : null}
      </ul>
    </div>
  );
}

function MissionProgressBar(props: {
  readonly percent: number;
  readonly completed: number;
  readonly total: number;
}) {
  return (
    <div className="office-mission-progress-bar-wrap">
      <div
        className="office-mission-progress-bar"
        role="progressbar"
        aria-valuenow={props.percent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`${props.completed} of ${props.total} tasks completed`}
      >
        <div
          className="office-mission-progress-bar-fill"
          style={{ width: `${props.percent}%` }}
        />
      </div>
      <p className="office-mission-progress-label">
        {props.total === 0
          ? "No linked tasks"
          : `${props.completed} / ${props.total} completed (${props.percent}%)`}
      </p>
    </div>
  );
}
