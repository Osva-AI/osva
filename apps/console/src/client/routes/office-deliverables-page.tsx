import { useMemo, useState } from "react";

import { OfficeDeliverablesTable } from "../components/office/office-deliverables-table";
import { OfficeSectionNav } from "../components/office/office-section-nav";
import { ErrorState } from "../components/error-state/error-state";
import { LoadingBlock } from "../components/loading/loading-block";
import { Button } from "../components/ui/button";
import { PageHeader } from "../components/ui/page-header";
import { SectionPanel } from "../components/ui/section-panel";
import { useOfficeDeliverableProvenanceContext } from "../hooks/use-office-deliverable-index";
import {
  useOfficeAssignmentsQuery,
  useOfficeGoalsQuery,
  useOfficeWorkersQuery,
} from "../hooks/use-office";
import { useWorkspaceArtifactsPageQuery } from "../hooks/use-workspace-artifacts-page";
import { resolveArtifactOfficeProvenance } from "../lib/office-deliverable-provenance";
import type { OfficeDeliverableRowView } from "../components/office/office-deliverables-table";

export function OfficeDeliverablesPage() {
  const artifactsPage = useWorkspaceArtifactsPageQuery();
  const provenance = useOfficeDeliverableProvenanceContext();
  const assignmentsQuery = useOfficeAssignmentsQuery();
  const goalsQuery = useOfficeGoalsQuery();
  const workersQuery = useOfficeWorkersQuery();

  const [missionFilter, setMissionFilter] = useState("");
  const [taskFilter, setTaskFilter] = useState("");
  const [workerFilter, setWorkerFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [nameSearch, setNameSearch] = useState("");

  const assignmentsById = useMemo(
    () =>
      new Map((assignmentsQuery.data?.items ?? []).map((row) => [row.id, row])),
    [assignmentsQuery.data?.items],
  );
  const goalsById = useMemo(
    () => new Map((goalsQuery.data?.items ?? []).map((row) => [row.id, row])),
    [goalsQuery.data?.items],
  );
  const workersById = useMemo(
    () => new Map((workersQuery.data?.items ?? []).map((row) => [row.id, row])),
    [workersQuery.data?.items],
  );

  const rows = useMemo((): OfficeDeliverableRowView[] => {
    const items = artifactsPage.data?.items ?? [];
    return items.map((artifact) => ({
      artifact,
      provenance: resolveArtifactOfficeProvenance(artifact, provenance.context),
    }));
  }, [artifactsPage.data?.items, provenance.context]);

  const filteredRows = useMemo(() => {
    const needle = nameSearch.trim().toLowerCase();
    const mediaNeedle = typeFilter.trim().toLowerCase();
    return rows.filter((row) => {
      if (
        needle.length > 0 &&
        !row.artifact.name.toLowerCase().includes(needle)
      ) {
        return false;
      }
      if (
        mediaNeedle.length > 0 &&
        !row.artifact.mediaType.toLowerCase().includes(mediaNeedle)
      ) {
        return false;
      }
      if (taskFilter.length > 0) {
        if (
          row.provenance.task.kind !== "verified" ||
          row.provenance.task.assignmentId !== taskFilter
        ) {
          return false;
        }
      }
      if (missionFilter.length > 0) {
        if (
          row.provenance.mission.kind !== "verified" ||
          row.provenance.mission.goalId !== missionFilter
        ) {
          return false;
        }
      }
      if (workerFilter.length > 0) {
        if (row.provenance.task.kind !== "verified") {
          return false;
        }
        const assignment = assignmentsById.get(
          row.provenance.task.assignmentId,
        );
        if (assignment?.officeWorkerId !== workerFilter) {
          return false;
        }
      }
      return true;
    });
  }, [
    assignmentsById,
    missionFilter,
    nameSearch,
    rows,
    taskFilter,
    typeFilter,
    workerFilter,
  ]);

  const loading = artifactsPage.isLoading;
  const assignments = assignmentsQuery.data?.items ?? [];
  const goals = goalsQuery.data?.items ?? [];
  const workers = workersQuery.data?.items ?? [];

  return (
    <div
      className="office-v2 page-stack activity-v2"
      data-testid="office-deliverables-page"
    >
      <PageHeader
        title="Deliverables"
        subtitle="Workspace artifacts with verified Office task and mission links when provenance allows."
      />
      <OfficeSectionNav active="deliverables" />

      <SectionPanel title="Filters">
        <p className="muted" role="note">
          Filters apply to the current artifact page only (
          {artifactsPage.data?.items.length ?? 0} loaded
          {artifactsPage.truncated ? ", more pages available" : ""}). They do
          not search the full workspace history.
        </p>
        <div className="filters">
          <div className="field">
            <label htmlFor="deliverable-search">Search by name</label>
            <input
              id="deliverable-search"
              value={nameSearch}
              onChange={(event) => setNameSearch(event.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="deliverable-type">Media type contains</label>
            <input
              id="deliverable-type"
              value={typeFilter}
              onChange={(event) => setTypeFilter(event.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="deliverable-mission">Mission</label>
            <select
              id="deliverable-mission"
              value={missionFilter}
              onChange={(event) => setMissionFilter(event.target.value)}
            >
              <option value="">All missions (this page)</option>
              {goals.map((goal) => (
                <option key={goal.id} value={goal.id}>
                  {goal.title}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="deliverable-task">Task</label>
            <select
              id="deliverable-task"
              value={taskFilter}
              onChange={(event) => setTaskFilter(event.target.value)}
            >
              <option value="">All tasks (this page)</option>
              {assignments.map((assignment) => (
                <option key={assignment.id} value={assignment.id}>
                  {assignment.title}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="deliverable-worker">Worker</label>
            <select
              id="deliverable-worker"
              value={workerFilter}
              onChange={(event) => setWorkerFilter(event.target.value)}
            >
              <option value="">All workers (this page)</option>
              {workers.map((worker) => (
                <option key={worker.id} value={worker.id}>
                  {worker.name}
                </option>
              ))}
            </select>
          </div>
        </div>
      </SectionPanel>

      {provenance.workflowPartialFailure ? (
        <ErrorState
          title="Some workflow executions could not be loaded"
          error={
            new Error(
              "Task links for workflow-backed deliverables may be incomplete on this page.",
            )
          }
        />
      ) : null}

      {loading ? <LoadingBlock label="Loading deliverables…" /> : null}
      {artifactsPage.isError ? (
        <ErrorState
          title="Failed to load artifacts"
          error={artifactsPage.error as Error}
        />
      ) : null}

      <SectionPanel title="Artifact library">
        {artifactsPage.truncated ? (
          <p className="muted" role="status">
            This is a paginated workspace artifact list. Additional pages exist;
            use Next page to continue.
          </p>
        ) : null}

        <OfficeDeliverablesTable
          rows={filteredRows}
          assignmentsById={assignmentsById}
          goalsById={goalsById}
          workersById={workersById}
          emptyTitle="No deliverables match the current filters on this page."
          emptyDescription={
            artifactsPage.data?.items.length === 0
              ? "Workspace artifacts will appear here when runs publish them."
              : undefined
          }
        />

        <div className="toolbar form-actions">
          <Button
            type="button"
            variant="secondary"
            disabled={!artifactsPage.canGoPrevious}
            onClick={() => artifactsPage.goPrevious()}
          >
            Previous page
          </Button>
          <Button
            type="button"
            variant="secondary"
            disabled={!artifactsPage.canGoNext}
            onClick={() => artifactsPage.goNext()}
          >
            Next page
          </Button>
        </div>
      </SectionPanel>
    </div>
  );
}
