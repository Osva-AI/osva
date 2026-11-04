import type { WorkflowNodeRunResource } from "../../hooks/use-workflow-runs";
import type { WorkflowDefinitionView } from "../../lib/workflow-definition";
import {
  resolveWorkflowCanvasLabel,
  type WorkflowCanvasLabelContext,
} from "../../lib/workflow-canvas-labels";
import { describeWorkflowNodeExecutionStatus } from "../../lib/workflow-execution-labels";
import {
  nodeRunsForKey,
  selectLatestNodeRunByKey,
} from "../../lib/workflow-node-run-overlay";
import { workflowNodeRunStatusCategory } from "../../lib/statuses";
import { StatusChip } from "../status/status-chip";

interface WorkflowRunExecutionListProps {
  readonly definition: WorkflowDefinitionView;
  readonly nodeRuns: readonly WorkflowNodeRunResource[];
  readonly selectedNodeKey: string | undefined;
  readonly onSelectNodeKey: (nodeKey: string) => void;
  readonly canvasLabels?: WorkflowCanvasLabelContext;
}

/**
 * Keyboard-accessible execution records grouped by definition node key.
 * Lists persisted WorkflowNodeRuns only — not a fabricated branch timeline.
 */
export function WorkflowRunExecutionList({
  definition,
  nodeRuns,
  selectedNodeKey,
  onSelectNodeKey,
  canvasLabels,
}: WorkflowRunExecutionListProps) {
  const latestByKey = selectLatestNodeRunByKey(nodeRuns);

  return (
    <nav
      className="workflow-run-execution-list"
      aria-labelledby="workflow-run-execution-list-title"
      data-testid="workflow-run-execution-list"
    >
      <h3 id="workflow-run-execution-list-title" className="section-title">
        Execution records
      </h3>
      <p className="muted workflow-run-execution-list-hint">
        Persisted WorkflowNodeRun rows by node. Parallel and branch paths are
        not collapsed into a single linear timeline.
      </p>
      <ul className="workflow-run-execution-list-items">
        {definition.nodes.map((node) => {
          const latest = latestByKey.get(node.key);
          const related = nodeRunsForKey(nodeRuns, node.key);
          const title = resolveWorkflowCanvasLabel(node as never, canvasLabels);
          const statusLabel =
            latest === undefined
              ? "No record"
              : describeWorkflowNodeExecutionStatus(latest.status);
          const selected = selectedNodeKey === node.key;
          return (
            <li key={node.key}>
              <button
                type="button"
                className={`workflow-run-execution-list-item${selected ? " selected" : ""}`}
                aria-current={selected ? "true" : undefined}
                onClick={() => onSelectNodeKey(node.key)}
              >
                <span className="workflow-run-execution-list-item-title">
                  {title}
                </span>
                <span className="muted mono workflow-run-execution-list-item-key">
                  {node.key}
                </span>
                <StatusChip
                  status={latest?.status ?? "NO_RECORD"}
                  category={
                    latest === undefined
                      ? "inactive"
                      : workflowNodeRunStatusCategory(latest.status)
                  }
                  label={statusLabel}
                />
                {related.length > 1 ? (
                  <span className="muted workflow-run-execution-list-item-meta">
                    {related.length} records
                  </span>
                ) : null}
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
