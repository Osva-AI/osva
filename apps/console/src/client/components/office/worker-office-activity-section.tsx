import { useMemo } from "react";

import type { OfficeWorkerId } from "@osva-ai/contracts";
import { filterOfficeActivities } from "@osva/domain/office-activity";

import { useOfficeActivityFeedQuery } from "../../hooks/use-office-activity-feed";
import {
  useOfficeAssignmentsQuery,
  useOfficeGoalsQuery,
  useOfficeWorkersQuery,
} from "../../hooks/use-office";
import { OfficeActivityFeedList } from "./office-activity-feed";
import { SectionPanel } from "../ui/section-panel";
import { LoadingBlock } from "../loading/loading-block";

const WORKER_ACTIVITY_LIMIT = 15;

export function WorkerOfficeActivitySection(props: {
  readonly workspaceId: string;
  readonly officeWorkerId: string;
}) {
  const feedQuery = useOfficeActivityFeedQuery({
    pollWhenRunning: true,
    includeArtifacts: false,
    filter: { officeWorkerId: props.officeWorkerId as OfficeWorkerId },
  });
  const goalsQuery = useOfficeGoalsQuery();
  const workersQuery = useOfficeWorkersQuery();
  const assignmentsQuery = useOfficeAssignmentsQuery();

  const entries = useMemo(() => {
    if (feedQuery.feed === undefined) {
      return [];
    }
    return filterOfficeActivities(feedQuery.feed.entries, {
      officeWorkerId: props.officeWorkerId as OfficeWorkerId,
    }).slice(0, WORKER_ACTIVITY_LIMIT);
  }, [feedQuery.feed, props.officeWorkerId]);

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
          .filter((row) => row.officeWorkerId === props.officeWorkerId)
          .map((row) => [row.id, { title: row.title, status: row.status }]),
      ),
    [assignmentsQuery.data?.items, props.officeWorkerId],
  );

  const loading = feedQuery.isLoading || assignmentsQuery.isLoading;

  return (
    <SectionPanel title="Recent worker activity">
      <p className="muted">
        Activity where this Office Worker owns the task or a resolved workflow
        node attribution applies. Does not list every Run for the linked Agent
        platform-wide.
      </p>
      {loading ? <LoadingBlock label="Loading worker activity…" /> : null}
      {!loading ? (
        <OfficeActivityFeedList
          entries={entries}
          goalsById={goalsById}
          workersById={workersById}
          assignmentsById={assignmentsById}
          testId="worker-office-activity"
        />
      ) : null}
    </SectionPanel>
  );
}
