import { Link } from "react-router-dom";

import { useMissionDeliverablesQuery } from "../../hooks/use-mission-deliverables";
import type { OfficeAssignmentResource } from "../../hooks/use-office";
import { ErrorState } from "../error-state/error-state";
import { LoadingBlock } from "../loading/loading-block";
import { SectionPanel } from "../ui/section-panel";
import { OfficeDeliverablesTable } from "./office-deliverables-table";
import type { AssignmentId, GoalId } from "@osva-ai/contracts";

import type { OfficeDeliverableProvenanceView } from "../../lib/office-deliverable-provenance";
import {
  useOfficeGoalsQuery,
  useOfficeWorkersQuery,
} from "../../hooks/use-office";

export function MissionDeliverablesSection(props: {
  readonly missionId: string;
  readonly linkedAssignments: readonly OfficeAssignmentResource[];
}) {
  const deliverables = useMissionDeliverablesQuery(props.linkedAssignments);
  const workersQuery = useOfficeWorkersQuery();
  const goalsQuery = useOfficeGoalsQuery();

  const workersById = new Map(
    (workersQuery.data?.items ?? []).map((worker) => [worker.id, worker]),
  );
  const goalsById = new Map(
    (goalsQuery.data?.items ?? []).map((goal) => [goal.id, goal]),
  );
  const assignmentsById = new Map(
    props.linkedAssignments.map((assignment) => [assignment.id, assignment]),
  );

  const rows = deliverables.rows.map((row) => {
    const provenance: OfficeDeliverableProvenanceView = {
      task: {
        kind: "verified",
        assignmentId: row.assignment.id as AssignmentId,
      },
      mission:
        row.assignment.goalId !== undefined
          ? {
              kind: "verified",
              goalId: row.assignment.goalId as GoalId,
            }
          : { kind: "none" },
      producerRunId: row.artifact.producer?.runId,
    };
    return {
      artifact: row.artifact,
      provenance,
    };
  });

  const loading = deliverables.loading;
  const launchedCount = props.linkedAssignments.filter(
    (row) => row.runId !== undefined || row.workflowRunId !== undefined,
  ).length;

  return (
    <SectionPanel
      title="Deliverables"
      actions={
        <Link className="button button-secondary" to="/office/deliverables">
          Open deliverables library
        </Link>
      }
    >
      <p className="muted">
        Artifacts from tasks linked to this mission with verified producer runs.
        Workflow-backed tasks load only their own execution graphs.
      </p>
      {loading ? <LoadingBlock label="Loading deliverables…" /> : null}
      {deliverables.error ? (
        <ErrorState
          title="Some deliverables could not be loaded"
          error={new Error("One or more task artifact queries failed.")}
        />
      ) : null}
      {deliverables.failures.length > 0 ? (
        <ErrorState
          title="Partial deliverable retrieval"
          error={new Error(deliverables.failures.join(" "))}
        />
      ) : null}
      {launchedCount === 0 ? (
        <p className="muted" role="status">
          No launched tasks yet. Deliverables appear after execution produces
          artifacts.
        </p>
      ) : null}
      {!loading && launchedCount > 0 && rows.length === 0 ? (
        <p className="muted" role="status">
          No artifacts are associated with this mission&apos;s tasks yet. A
          completed task may legitimately produce zero artifacts.
        </p>
      ) : null}
      {rows.length > 0 ? (
        <OfficeDeliverablesTable
          rows={rows}
          assignmentsById={assignmentsById}
          goalsById={goalsById}
          workersById={workersById}
        />
      ) : null}
    </SectionPanel>
  );
}
