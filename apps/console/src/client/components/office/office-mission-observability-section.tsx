import { useMemo } from "react";

import type { GoalId, WorkspaceId } from "@osva-ai/contracts";
import { summarizeMissionPerformance } from "@osva/domain/office-observability";

import {
  mapOfficeObservabilityAssignments,
  OFFICE_USAGE_ROLLUP_DEFERRED_LABEL,
} from "../../lib/office-observability";
import type { OfficeAssignmentResource } from "../../hooks/use-office";
import { useWorkspaceQueryScope } from "../../hooks/use-workspace-query-scope";
import { SectionPanel } from "../ui/section-panel";
import { OfficeTaskMetricsPanel } from "./office-task-metrics-panel";

export function OfficeMissionObservabilitySection(props: {
  readonly missionId: string;
  readonly linkedAssignments: readonly OfficeAssignmentResource[];
  readonly verifiedDeliverablesCount?: number | null;
}) {
  const workspaceId = useWorkspaceQueryScope();

  const summary = useMemo(() => {
    if (workspaceId === undefined) {
      return undefined;
    }
    return summarizeMissionPerformance(
      props.missionId as GoalId,
      mapOfficeObservabilityAssignments(props.linkedAssignments),
      {
        ...(props.verifiedDeliverablesCount !== undefined
          ? { verifiedDeliverablesCount: props.verifiedDeliverablesCount }
          : {}),
      },
      workspaceId as WorkspaceId,
    );
  }, [
    props.linkedAssignments,
    props.missionId,
    props.verifiedDeliverablesCount,
    workspaceId,
  ]);

  if (summary === undefined) {
    return null;
  }

  return (
    <SectionPanel title="Mission execution metrics">
      <p className="muted">
        Task-derived metrics for this mission. Goal status is managed separately
        and is not auto-completed from task outcomes.
      </p>
      {props.verifiedDeliverablesCount !== undefined &&
      props.verifiedDeliverablesCount !== null ? (
        <p className="office-observability-inline-meta">
          Verified deliverables (loaded scope):{" "}
          <strong>{props.verifiedDeliverablesCount}</strong>
        </p>
      ) : null}
      <OfficeTaskMetricsPanel
        summary={summary}
        testId="office-mission-task-metrics"
        scopeLabel={`${summary.linkedTaskCount} tasks linked via Assignment.goalId.`}
      />
      <p className="muted" role="note">
        {OFFICE_USAGE_ROLLUP_DEFERRED_LABEL}
      </p>
    </SectionPanel>
  );
}
