import { useMemo } from "react";
import { Link } from "react-router-dom";

import type { OfficeWorkerId, WorkspaceId } from "@osva-ai/contracts";
import { summarizeWorkerPerformance } from "@osva/domain/office-observability";

import {
  formatTerminalSuccessRatePercent,
  mapOfficeObservabilityAssignments,
  OFFICE_USAGE_ROLLUP_DEFERRED_LABEL,
} from "../../lib/office-observability";
import { useOfficeAssignmentsQuery } from "../../hooks/use-office";
import { useWorkspaceQueryScope } from "../../hooks/use-workspace-query-scope";
import { SectionPanel } from "../ui/section-panel";
import { LoadingBlock } from "../loading/loading-block";
import { OfficeTaskMetricsPanel } from "./office-task-metrics-panel";

export function OfficeWorkerPerformanceSection(props: {
  readonly officeWorkerId: string;
}) {
  const workspaceId = useWorkspaceQueryScope();
  const assignmentsQuery = useOfficeAssignmentsQuery();

  const summary = useMemo(() => {
    if (assignmentsQuery.data === undefined || workspaceId === undefined) {
      return undefined;
    }
    const records = mapOfficeObservabilityAssignments(
      assignmentsQuery.data.items,
    );
    return summarizeWorkerPerformance(
      props.officeWorkerId as OfficeWorkerId,
      records,
      workspaceId as WorkspaceId,
    );
  }, [assignmentsQuery.data, props.officeWorkerId, workspaceId]);

  const loading = assignmentsQuery.isLoading;

  return (
    <SectionPanel title="Task performance summary">
      <p className="muted">
        Counts tasks assigned to this Office Worker (
        <span className="mono">Assignment.officeWorkerId</span>). Not every
        Agent run in the workspace is attributed here.
      </p>
      {loading ? <LoadingBlock label="Loading worker metrics…" /> : null}
      {summary !== undefined ? (
        <>
          <p className="office-observability-inline-meta">
            Completion rate (completed / all assigned):{" "}
            <strong>
              {summary.completionRate === null
                ? "—"
                : `${Math.round(summary.completionRate * 100)}%`}
            </strong>
            {" · "}
            Terminal success:{" "}
            <strong>{formatTerminalSuccessRatePercent(summary)}</strong>
          </p>
          <OfficeTaskMetricsPanel
            summary={summary}
            testId="office-worker-task-metrics"
            scopeLabel="Tasks assigned to this worker in the workspace assignment list."
          />
        </>
      ) : null}
      <p className="muted" role="note">
        {OFFICE_USAGE_ROLLUP_DEFERRED_LABEL}{" "}
        <Link to="/office/tasks">Browse tasks</Link> for execution links.
      </p>
    </SectionPanel>
  );
}
