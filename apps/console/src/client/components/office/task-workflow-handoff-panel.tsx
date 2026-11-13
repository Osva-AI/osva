import { lazy, Suspense, useMemo } from "react";
import { Link } from "react-router-dom";

import type { OfficeWorkflowHandoffProjection } from "@osva/domain/office-execution-context";

import { handoffEdgeKindToGraphAppearance } from "../../lib/office-execution-context";
import type { WorkflowDefinitionView } from "../../lib/workflow-definition";
import { resolveWorkflowCanvasLabel } from "../../lib/workflow-canvas-labels";
import { useWorkflowCanvasLabelContext } from "../../hooks/use-workflow-canvas-label-context";
import { workflowEdgeId } from "../../lib/workflow-definition";
import { LoadingBlock } from "../loading/loading-block";

const WorkflowGraphViewLazy = lazy(async () => {
  const module = await import("../workflow/workflow-graph-view");
  return { default: module.WorkflowGraphView };
});

interface TaskWorkflowHandoffPanelProps {
  readonly projection: OfficeWorkflowHandoffProjection;
  readonly definition: WorkflowDefinitionView;
  readonly workflowRunId: string;
}

export function TaskWorkflowHandoffPanel({
  projection,
  definition,
  workflowRunId,
}: TaskWorkflowHandoffPanelProps) {
  const canvasLabels = useWorkflowCanvasLabelContext();

  const edgeAppearanceById = useMemo(() => {
    const appearances: Record<string, "selected" | "inactive" | "skipped"> = {};
    for (const edge of projection.edges) {
      const appearance = handoffEdgeKindToGraphAppearance(edge.kind);
      if (appearance !== undefined) {
        appearances[edge.id] = appearance;
      }
    }
    return appearances;
  }, [projection.edges]);

  const executedEdges = projection.edges.filter(
    (edge) => edge.kind !== "DEFINED_CONNECTION",
  );

  return (
    <div
      className="office-task-handoff-panel"
      data-testid="task-workflow-handoff-panel"
    >
      <h3 className="panel-title">Workflow handoffs</h3>
      <p className="muted">
        Defined connections show the published graph. Highlighted edges reflect
        persisted execution only — not synthetic delegation.
      </p>
      {projection.blockingNodeKey !== undefined ? (
        <p className="form-feedback" role="status">
          Blocking point:{" "}
          <span className="mono">{projection.blockingNodeKey}</span>
        </p>
      ) : null}
      {definition.schemaVersion === "3" ? (
        <div
          className="office-task-handoff-graph"
          data-testid="task-workflow-handoff-graph"
        >
          <Suspense fallback={<LoadingBlock label="Loading handoff graph…" />}>
            <WorkflowGraphViewLazy
              definition={definition}
              executionStatusByNodeKey={projection.executionStatusByNodeKey}
              edgeAppearanceById={edgeAppearanceById}
              canvasLabelContext={canvasLabels}
            />
          </Suspense>
        </div>
      ) : (
        <p className="muted">
          Handoff graph overlay requires workflow definition schema version 3.
        </p>
      )}
      {executedEdges.length > 0 ? (
        <dl className="office-task-handoff-edges">
          {executedEdges.map((edge) => {
            const fromDef = definition.nodes.find(
              (node) => node.key === edge.fromKey,
            );
            const toDef = definition.nodes.find(
              (node) => node.key === edge.toKey,
            );
            const fromLabel =
              fromDef === undefined
                ? edge.fromKey
                : resolveWorkflowCanvasLabel(fromDef as never, canvasLabels);
            const toLabel =
              toDef === undefined
                ? edge.toKey
                : resolveWorkflowCanvasLabel(toDef as never, canvasLabels);
            return (
              <div key={edge.id} data-testid={`handoff-edge-${edge.id}`}>
                <dt className="metric-label">{edge.terminologyLabel}</dt>
                <dd>
                  {fromLabel} → {toLabel}
                </dd>
              </div>
            );
          })}
        </dl>
      ) : (
        <p className="muted" data-testid="task-handoff-edges-empty">
          No executed handoffs yet — only defined workflow connections.
        </p>
      )}
      <p>
        <Link
          to={`/workflow-runs/${workflowRunId}`}
          data-testid="task-workflow-handoff-detail-link"
        >
          Open WorkflowRun detail
        </Link>
      </p>
    </div>
  );
}

/** Stable edge id for handoff tests (mirrors graph adapter). */
export function officeHandoffEdgeId(fromKey: string, toKey: string): string {
  return workflowEdgeId(fromKey, toKey);
}
