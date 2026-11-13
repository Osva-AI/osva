import { useMemo } from "react";
import { Link } from "react-router-dom";

import type { OfficeWorkerId, WorkspaceId } from "@osva-ai/contracts";
import { summarizeTeamPerformance } from "@osva/domain/office-observability";

import {
  mapOfficeObservabilityAssignments,
  OFFICE_TEAM_METRICS_SCOPE_LABEL,
  OFFICE_USAGE_ROLLUP_DEFERRED_LABEL,
} from "../../lib/office-observability";
import { useOfficeAssignmentsQuery } from "../../hooks/use-office";
import { useWorkspaceQueryScope } from "../../hooks/use-workspace-query-scope";
import { SectionPanel } from "../ui/section-panel";
import { LoadingBlock } from "../loading/loading-block";
import { OfficeTaskMetricsPanel } from "./office-task-metrics-panel";

export function OfficeTeamOperationsSection(props: {
  readonly teamId: string;
  readonly memberWorkerIds: readonly string[];
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
    return summarizeTeamPerformance(
      props.teamId,
      props.memberWorkerIds as OfficeWorkerId[],
      records,
      workspaceId as WorkspaceId,
    );
  }, [assignmentsQuery.data, props.memberWorkerIds, props.teamId, workspaceId]);

  const loading = assignmentsQuery.isLoading;

  return (
    <SectionPanel title="Team task operations">
      <p className="muted">{OFFICE_TEAM_METRICS_SCOPE_LABEL}</p>
      {loading ? <LoadingBlock label="Loading team metrics…" /> : null}
      {summary !== undefined ? (
        <OfficeTaskMetricsPanel
          summary={summary}
          testId="office-team-task-metrics"
          scopeLabel={`${summary.distinctAssignedTaskCount} distinct tasks for ${summary.memberWorkerIds.length} current member(s).`}
        />
      ) : null}
      {props.memberWorkerIds.length === 0 ? (
        <p className="muted">Add workers to see team operational metrics.</p>
      ) : null}
      <p className="muted" role="note">
        {OFFICE_USAGE_ROLLUP_DEFERRED_LABEL}{" "}
        <Link to="/office/workers">Open workers</Link> for per-worker summaries.
      </p>
    </SectionPanel>
  );
}
