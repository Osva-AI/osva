import { Link } from "react-router-dom";
import { useMemo } from "react";

import { LoadingBlock } from "../loading/loading-block";
import { SectionPanel } from "../ui/section-panel";
import { StatusChip } from "../status/status-chip";
import {
  useOfficeAssignmentsQuery,
  useOfficeGoalsQuery,
} from "../../hooks/use-office";
import {
  buildWorkerAssignmentActivityRows,
  workerAssignmentExecutionPath,
} from "../../lib/office-execution-context";
import { formatTimestamp } from "../../lib/formatting";
import { assignmentStatusCategory } from "../../lib/office-presentation";

const WORKER_ASSIGNMENT_HISTORY_LIMIT = 25;

interface WorkerAssignmentActivitySectionProps {
  readonly workspaceId: string;
  readonly officeWorkerId: string;
}

export function WorkerAssignmentActivitySection({
  workspaceId,
  officeWorkerId,
}: WorkerAssignmentActivitySectionProps) {
  const assignmentsQuery = useOfficeAssignmentsQuery();
  const goalsQuery = useOfficeGoalsQuery();

  const goalsById = useMemo(
    () =>
      new Map(
        (goalsQuery.data?.items ?? []).map((goal) => [goal.id, goal.title]),
      ),
    [goalsQuery.data?.items],
  );

  const rows = useMemo(() => {
    if (assignmentsQuery.data === undefined) {
      return [];
    }
    return buildWorkerAssignmentActivityRows({
      workspaceId,
      officeWorkerId,
      assignments: assignmentsQuery.data.items,
      limit: WORKER_ASSIGNMENT_HISTORY_LIMIT,
    });
  }, [assignmentsQuery.data, officeWorkerId, workspaceId]);

  const loading = assignmentsQuery.isLoading || goalsQuery.isLoading;

  return (
    <SectionPanel title="Office Assignment activity">
      <p className="muted">
        Recent tasks assigned to this Office Worker in the current workspace.
        This is not a complete history of all Agent runs on the platform.
      </p>
      {loading ? <LoadingBlock label="Loading assignment activity…" /> : null}
      {!loading && rows.length === 0 ? (
        <p className="muted" data-testid="worker-assignment-activity-empty">
          No assignments for this worker yet.
        </p>
      ) : null}
      {rows.length > 0 ? (
        <div
          className="data-table-region"
          data-testid="worker-assignment-activity"
        >
          <table>
            <caption className="sr-only">
              Recent Office Assignments for this worker
            </caption>
            <thead>
              <tr>
                <th scope="col">Task</th>
                <th scope="col">Status</th>
                <th scope="col">Mission</th>
                <th scope="col">Execution</th>
                <th scope="col">Created</th>
                <th scope="col">Completed</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const executionPath = workerAssignmentExecutionPath(row);
                const missionTitle =
                  row.goalId !== undefined
                    ? goalsById.get(row.goalId)
                    : undefined;
                return (
                  <tr key={row.assignmentId}>
                    <td>
                      <Link to={`/office/tasks/${row.assignmentId}`}>
                        {row.title}
                      </Link>
                    </td>
                    <td>
                      <StatusChip
                        status={row.status}
                        category={assignmentStatusCategory(row.status)}
                      />
                    </td>
                    <td>
                      {row.goalId !== undefined ? (
                        missionTitle !== undefined ? (
                          <Link to={`/office/missions/${row.goalId}`}>
                            {missionTitle}
                          </Link>
                        ) : (
                          <span className="mono">{row.goalId}</span>
                        )
                      ) : (
                        "—"
                      )}
                    </td>
                    <td>
                      {executionPath !== undefined ? (
                        <Link to={executionPath} className="mono">
                          {row.runId ?? row.workflowRunId}
                        </Link>
                      ) : (
                        "Not launched"
                      )}
                    </td>
                    <td>{formatTimestamp(row.createdAt)}</td>
                    <td>{formatTimestamp(row.completedAt)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}
    </SectionPanel>
  );
}
