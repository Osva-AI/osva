import { useEffect } from "react";
import { Link } from "react-router-dom";

import { useArtifactPreview } from "../../hooks/use-artifact-preview";
import type { OfficeGoalResource } from "../../hooks/use-office";
import type { OfficeAssignmentResource } from "../../hooks/use-office";
import type { OfficeWorkerResource } from "../../hooks/use-office";
import type { ArtifactResource } from "../../hooks/use-runs";
import {
  artifactContentPath,
  classifyArtifactPreview,
} from "../../lib/artifact-preview";
import { formatBytes, formatTimestamp } from "../../lib/formatting";
import type { OfficeDeliverableProvenanceView } from "../../lib/office-deliverable-provenance";
import { EmptyState } from "../empty-state/empty-state";
import { JsonView } from "../json-view/json-view";
import { ArtifactPreviewPanel } from "../artifact/artifact-preview-panel";

export interface OfficeDeliverableRowView {
  readonly artifact: ArtifactResource;
  readonly provenance: OfficeDeliverableProvenanceView;
}

export function OfficeDeliverablesTable(props: {
  readonly rows: readonly OfficeDeliverableRowView[];
  readonly assignmentsById: ReadonlyMap<string, OfficeAssignmentResource>;
  readonly goalsById: ReadonlyMap<string, OfficeGoalResource>;
  readonly workersById: ReadonlyMap<string, OfficeWorkerResource>;
  readonly emptyTitle?: string;
  readonly emptyDescription?: string;
}) {
  const preview = useArtifactPreview();
  const selected = props.rows.find(
    (row) => row.artifact.id === preview.selectedId,
  )?.artifact;

  useEffect(() => {
    if (
      preview.selectedId !== undefined &&
      !props.rows.some((row) => row.artifact.id === preview.selectedId)
    ) {
      preview.close();
    }
  }, [preview.close, preview.selectedId, props.rows]);

  if (props.rows.length === 0) {
    return (
      <EmptyState
        title={props.emptyTitle ?? "No deliverables in this view."}
        description={props.emptyDescription}
      />
    );
  }

  return (
    <>
      <div className="artifact-table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col">Media type</th>
              <th scope="col">Size</th>
              <th scope="col">Created</th>
              <th scope="col">Producer run</th>
              <th scope="col">Task</th>
              <th scope="col">Mission</th>
              <th scope="col">Worker</th>
              <th scope="col">Actions</th>
            </tr>
          </thead>
          <tbody>
            {props.rows.map((row) => (
              <OfficeDeliverableRow
                key={row.artifact.id}
                row={row}
                assignment={
                  row.provenance.task.kind === "verified"
                    ? props.assignmentsById.get(
                        row.provenance.task.assignmentId,
                      )
                    : undefined
                }
                goal={
                  row.provenance.mission.kind === "verified"
                    ? props.goalsById.get(row.provenance.mission.goalId)
                    : undefined
                }
                worker={
                  row.provenance.task.kind === "verified"
                    ? props.workersById.get(
                        props.assignmentsById.get(
                          row.provenance.task.assignmentId,
                        )?.officeWorkerId ?? "",
                      )
                    : undefined
                }
                selected={preview.selectedId === row.artifact.id}
                onPreview={() => preview.open(row.artifact)}
              />
            ))}
          </tbody>
        </table>
      </div>
      {selected !== undefined && preview.status !== "closed" ? (
        <ArtifactPreviewPanel
          artifact={selected}
          status={preview.status}
          text={preview.text}
          error={preview.error}
          onClose={preview.close}
        />
      ) : null}
    </>
  );
}

function OfficeDeliverableRow({
  row,
  assignment,
  goal,
  worker,
  selected,
  onPreview,
}: {
  readonly row: OfficeDeliverableRowView;
  readonly assignment: OfficeAssignmentResource | undefined;
  readonly goal: OfficeGoalResource | undefined;
  readonly worker: OfficeWorkerResource | undefined;
  readonly selected: boolean;
  readonly onPreview: () => void;
}) {
  const { artifact, provenance } = row;
  const capability = classifyArtifactPreview(artifact);
  const canRequestPreview = capability === "text" || capability === "json";

  const taskCell =
    provenance.task.kind === "verified" && assignment !== undefined ? (
      <Link to={`/office/tasks/${assignment.id}`}>{assignment.title}</Link>
    ) : provenance.task.kind === "ambiguous" ? (
      <span className="muted">Ambiguous task link</span>
    ) : (
      <span className="muted">No verified Office task</span>
    );

  const missionCell =
    provenance.mission.kind === "verified" && goal !== undefined ? (
      <Link to={`/office/missions/${goal.id}`}>{goal.title}</Link>
    ) : provenance.task.kind === "verified" ? (
      <span className="muted">—</span>
    ) : (
      <span className="muted">—</span>
    );

  const workerCell =
    worker !== undefined ? (
      <Link to={`/office/workers/${worker.id}`}>{worker.name}</Link>
    ) : (
      <span className="muted">—</span>
    );

  return (
    <tr className={selected ? "artifact-row-selected" : undefined}>
      <td>
        <div className="artifact-name">{artifact.name}</div>
        {artifact.metadata !== undefined &&
        Object.keys(artifact.metadata).length > 0 ? (
          <details>
            <summary>Metadata</summary>
            <JsonView label="Metadata" value={artifact.metadata} />
          </details>
        ) : null}
      </td>
      <td className="mono">{artifact.mediaType}</td>
      <td>{formatBytes(artifact.sizeBytes)}</td>
      <td>{formatTimestamp(artifact.createdAt)}</td>
      <td className="mono">
        {artifact.producer !== undefined ? (
          <Link to={`/runs/${artifact.producer.runId}`}>
            {artifact.producer.runId}
          </Link>
        ) : (
          "—"
        )}
      </td>
      <td>{taskCell}</td>
      <td>{missionCell}</td>
      <td>{workerCell}</td>
      <td>
        <div className="toolbar artifact-actions">
          {canRequestPreview ? (
            <button
              type="button"
              className="button"
              onClick={onPreview}
              aria-label={`Preview ${artifact.name}`}
              aria-pressed={selected}
            >
              Preview
            </button>
          ) : (
            <button
              type="button"
              className="button"
              onClick={onPreview}
              aria-label={`Why ${artifact.name} cannot be previewed`}
              aria-pressed={selected}
            >
              Preview unavailable
            </button>
          )}
          <a
            className="button"
            href={artifactContentPath(artifact.id)}
            download={artifact.name}
            aria-label={`Download ${artifact.name}`}
          >
            Download
          </a>
        </div>
      </td>
    </tr>
  );
}
