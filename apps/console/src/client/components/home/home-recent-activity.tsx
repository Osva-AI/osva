import { Link } from "react-router-dom";

import type { RunResource } from "../../hooks/use-runs";
import type { WorkflowRunSummaryResource } from "../../hooks/use-workflow-runs";
import { formatTimestamp } from "../../lib/formatting";
import type { RecentListPresentation } from "../../lib/overview-counts";
import {
  runStatusCategory,
  workflowRunStatusCategory,
} from "../../lib/statuses";
import { EmptyState } from "../empty-state/empty-state";
import { ErrorState } from "../error-state/error-state";
import { StatusChip } from "../status/status-chip";
import { SectionPanel } from "../ui/section-panel";

export function HomeRecentActivity({
  recentRuns,
  recentWorkflowRuns,
  runsPresentation,
  workflowRunsPresentation,
  runsError,
  workflowRunsError,
  canExecute,
  canWrite,
}: {
  readonly recentRuns: readonly RunResource[];
  readonly recentWorkflowRuns: readonly WorkflowRunSummaryResource[];
  readonly runsPresentation: RecentListPresentation;
  readonly workflowRunsPresentation: RecentListPresentation;
  readonly runsError: unknown;
  readonly workflowRunsError: unknown;
  readonly canExecute: boolean;
  readonly canWrite: boolean;
}) {
  return (
    <>
      <SectionPanel
        title="Recent agent runs"
        description={`Showing ${String(runsPresentation.shown)} of up to ${String(runsPresentation.limit)}${runsPresentation.hasMore ? " (more on Runs page)" : ""}.`}
        actions={<Link to="/runs">View all runs</Link>}
      >
        {runsError !== undefined && runsError !== null ? (
          <ErrorState title="Runs unavailable" error={runsError} />
        ) : recentRuns.length === 0 ? (
          <>
            <EmptyState
              title="No runs yet"
              description="Launch a Run from an AgentVersion after publishing."
            />
            {canExecute ? (
              <Link className="button" to="/agents">
                Open agents
              </Link>
            ) : null}
          </>
        ) : (
          <ul className="home-activity-list">
            {recentRuns.map((run) => (
              <li key={run.id} className="home-activity-item">
                <div>
                  <Link to={`/runs/${encodeURIComponent(run.id)}`}>
                    Run {run.id}
                  </Link>
                  <p className="muted mono home-activity-secondary">
                    Agent {run.agentId}
                  </p>
                </div>
                <div className="home-activity-meta">
                  <StatusChip
                    status={run.status}
                    category={runStatusCategory(run.status)}
                  />
                  <span className="muted">
                    {formatTimestamp(run.updatedAt)}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </SectionPanel>

      <SectionPanel
        title="Recent workflow runs"
        description={`Showing ${String(workflowRunsPresentation.shown)} of up to ${String(workflowRunsPresentation.limit)}${workflowRunsPresentation.hasMore ? " (more on Workflow Runs page)" : ""}.`}
        actions={<Link to="/workflow-runs">View all workflow runs</Link>}
      >
        {workflowRunsError !== undefined && workflowRunsError !== null ? (
          <ErrorState
            title="Workflow runs unavailable"
            error={workflowRunsError}
          />
        ) : recentWorkflowRuns.length === 0 ? (
          <>
            <EmptyState
              title="No workflow runs yet"
              description="Publish a workflow version and launch a WorkflowRun."
            />
            {canWrite ? (
              <Link className="button" to="/workflows">
                Open workflows
              </Link>
            ) : null}
          </>
        ) : (
          <ul className="home-activity-list">
            {recentWorkflowRuns.map((run) => (
              <li key={run.id} className="home-activity-item">
                <div>
                  <Link to={`/workflow-runs/${encodeURIComponent(run.id)}`}>
                    Workflow run {run.id}
                  </Link>
                  <p className="muted mono home-activity-secondary">
                    Workflow {run.workflowId}
                  </p>
                </div>
                <div className="home-activity-meta">
                  <StatusChip
                    status={run.status}
                    category={workflowRunStatusCategory(run.status)}
                  />
                  <span className="muted">
                    {formatTimestamp(run.updatedAt)}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </SectionPanel>
    </>
  );
}
