import { useMemo } from "react";
import { Link } from "react-router-dom";

import {
  filterOfficeActivities,
  paginateOfficeActivitiesBounded,
} from "@osva/domain/office-activity";

import { useOfficeActivityFeedQuery } from "../../hooks/use-office-activity-feed";
import {
  useOfficeAssignmentsQuery,
  useOfficeGoalsQuery,
  useOfficeWorkersQuery,
} from "../../hooks/use-office";
import { OfficeActivityFeedList } from "./office-activity-feed";
import { SectionPanel } from "../ui/section-panel";
import { LoadingBlock } from "../loading/loading-block";
import { OFFICE_ACTIVITY_RECENT_LIMIT } from "../../lib/office-activity";

const MISSION_CONTROL_ACTIVITY_LIMIT = 8;
const MISSION_CONTROL_DELIVERABLE_LIMIT = 6;

export function MissionControlRecentSections() {
  const feedQuery = useOfficeActivityFeedQuery({
    pollWhenRunning: false,
    includeArtifacts: true,
  });
  const goalsQuery = useOfficeGoalsQuery();
  const workersQuery = useOfficeWorkersQuery();
  const assignmentsQuery = useOfficeAssignmentsQuery();

  const activityEntries = useMemo(() => {
    if (feedQuery.feed === undefined) {
      return [];
    }
    return paginateOfficeActivitiesBounded(
      feedQuery.feed.entries,
      MISSION_CONTROL_ACTIVITY_LIMIT,
    ).items;
  }, [feedQuery.feed]);

  const deliverableEntries = useMemo(() => {
    if (feedQuery.feed === undefined) {
      return [];
    }
    return filterOfficeActivities(feedQuery.feed.entries, {
      activityType: "ARTIFACT_CREATED",
    }).slice(0, MISSION_CONTROL_DELIVERABLE_LIMIT);
  }, [feedQuery.feed]);

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
        (assignmentsQuery.data?.items ?? []).map((row) => [
          row.id,
          { title: row.title, status: row.status },
        ]),
      ),
    [assignmentsQuery.data?.items],
  );

  const loading = feedQuery.isLoading || assignmentsQuery.isLoading;

  return (
    <>
      <SectionPanel title="Recent Office activity">
        <p className="muted">
          Bounded feed ({MISSION_CONTROL_ACTIVITY_LIMIT} of{" "}
          {OFFICE_ACTIVITY_RECENT_LIMIT} max). Workflow steps load for launched
          workflow tasks only.
        </p>
        {loading ? <LoadingBlock label="Loading activity…" /> : null}
        {!loading ? (
          <OfficeActivityFeedList
            entries={activityEntries}
            goalsById={goalsById}
            workersById={workersById}
            assignmentsById={assignmentsById}
            testId="mission-control-office-activity"
          />
        ) : null}
        {feedQuery.workflowPartialFailure ? (
          <p className="muted form-feedback" role="status">
            Some workflow data failed to load; activity may be incomplete.
          </p>
        ) : null}
        <p className="muted">
          <Link to="/office/activity">Open full Office Activity</Link>
        </p>
      </SectionPanel>

      <SectionPanel title="Recent deliverables">
        <p className="muted">
          Verified Office deliverables from the first artifact list page (
          {MISSION_CONTROL_DELIVERABLE_LIMIT} shown).
        </p>
        {loading ? <LoadingBlock label="Loading deliverables…" /> : null}
        {!loading && deliverableEntries.length === 0 ? (
          <p className="muted">No verified deliverable events loaded.</p>
        ) : null}
        {!loading && deliverableEntries.length > 0 ? (
          <ul className="office-v2-simple-list">
            {deliverableEntries.map((entry) => (
              <li key={entry.id}>
                <Link to={entry.navigation.href}>
                  {entry.assignmentTitle ?? "Deliverable"}
                </Link>
                {entry.occurredAt !== undefined ? (
                  <span className="muted"> · {entry.occurredAt}</span>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}
        <p className="muted">
          <Link to="/office/deliverables">Open deliverables library</Link>
        </p>
      </SectionPanel>
    </>
  );
}
