import { useMemo } from "react";

import type { GoalId } from "@osva-ai/contracts";

import { useOfficeActivityFeedQuery } from "../../hooks/use-office-activity-feed";
import {
  useOfficeAssignmentsQuery,
  useOfficeGoalsQuery,
  useOfficeWorkersQuery,
} from "../../hooks/use-office";
import { filterOfficeActivities } from "@osva/domain/office-activity";
import { OfficeActivityFeedList } from "./office-activity-feed";
import { SectionPanel } from "../ui/section-panel";
import { LoadingBlock } from "../loading/loading-block";

const MISSION_ACTIVITY_LIMIT = 15;

export function MissionOfficeActivitySection(props: {
  readonly workspaceId: string;
  readonly missionId: string;
}) {
  const feedQuery = useOfficeActivityFeedQuery({
    pollWhenRunning: true,
    includeArtifacts: false,
    filter: { goalId: props.missionId as GoalId },
  });
  const goalsQuery = useOfficeGoalsQuery();
  const workersQuery = useOfficeWorkersQuery();
  const assignmentsQuery = useOfficeAssignmentsQuery();

  const entries = useMemo(() => {
    if (feedQuery.feed === undefined) {
      return [];
    }
    return filterOfficeActivities(feedQuery.feed.entries, {
      goalId: props.missionId as GoalId,
    }).slice(0, MISSION_ACTIVITY_LIMIT);
  }, [feedQuery.feed, props.missionId]);

  const goalsById = useMemo(
    () =>
      new Map((goalsQuery.data?.items ?? []).map((row) => [row.id, row.title])),
    [goalsQuery.data?.items],
  );
  const workersById = useMemo(
    () =>
      new Map(
        (workersQuery.data?.items ?? []).map((row) => [row.id, row.name]),
      ),
    [workersQuery.data?.items],
  );
  const assignmentsById = useMemo(
    () =>
      new Map(
        (assignmentsQuery.data?.items ?? [])
          .filter((row) => row.goalId === props.missionId)
          .map((row) => [row.id, { title: row.title, status: row.status }]),
      ),
    [assignmentsQuery.data?.items, props.missionId],
  );

  const loading = feedQuery.isLoading || assignmentsQuery.isLoading;

  return (
    <SectionPanel title="Recent mission activity">
      <p className="muted">
        Bounded summary from verified tasks on this mission (
        {MISSION_ACTIVITY_LIMIT} entries max). Workflow steps load only for
        mission tasks that launched a WorkflowRun. Not a complete mission
        execution archive.
      </p>
      {loading ? <LoadingBlock label="Loading mission activity…" /> : null}
      {!loading ? (
        <OfficeActivityFeedList
          entries={entries}
          goalsById={goalsById}
          workersById={workersById}
          assignmentsById={assignmentsById}
          testId="mission-office-activity"
        />
      ) : null}
      {feedQuery.workflowPartialFailure ? (
        <p className="muted form-feedback" role="status">
          Some workflow data failed to load; activity may be incomplete.
        </p>
      ) : null}
    </SectionPanel>
  );
}
