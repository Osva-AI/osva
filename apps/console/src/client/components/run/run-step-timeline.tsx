import type { RunStepResource } from "../../hooks/use-runs";
import {
  formatActivityTimestamp,
  formatDurationMs,
  formatUsdMicros,
} from "../../lib/formatting";
import {
  describeRunStepKind,
  runExecutionStatusLabel,
} from "../../lib/run-execution-labels";
import { EmptyState } from "../empty-state/empty-state";
import { StatusChip } from "../status/status-chip";
import { attemptStatusCategory } from "../../lib/statuses";
import { buildRunStepToolDiagnosticsView } from "../../lib/execution-diagnostics";
import { OperatorGuidancePanel } from "../operator/operator-guidance";

interface RunStepTimelineProps {
  readonly steps: readonly RunStepResource[] | undefined;
  readonly isLoading: boolean;
  readonly isLive: boolean;
  readonly terminalSucceeded?: boolean;
}

function stepStatusCategory(status: string) {
  return attemptStatusCategory(status);
}

export function RunStepTimeline({
  steps,
  isLoading,
  isLive,
  terminalSucceeded = false,
}: RunStepTimelineProps) {
  if (isLoading) {
    return <p className="muted">Loading execution timeline…</p>;
  }

  if (steps === undefined || steps.length === 0) {
    return (
      <EmptyState
        title={
          isLive
            ? "No execution steps yet."
            : terminalSucceeded
              ? "No RunSteps were persisted for this attempt."
              : "No execution steps were recorded."
        }
        description={
          isLive
            ? "Model and tool steps appear here as the worker persists RunSteps."
            : terminalSucceeded
              ? "The attempt succeeded without step-level history. Check Results for output, artifacts, and usage totals."
              : undefined
        }
      />
    );
  }

  return (
    <ol className="run-step-timeline" data-testid="run-step-timeline">
      {steps.map((step, index) => {
        const bindingRef =
          step.modelProfileVersionId ?? step.toolVersionId ?? undefined;
        const toolDiagnostics = buildRunStepToolDiagnosticsView(step);
        return (
          <li key={step.id} className="run-step-timeline-item">
            <div className="run-step-timeline-marker" aria-hidden="true">
              {index + 1}
            </div>
            <article className="run-step-timeline-card panel">
              <header className="run-step-timeline-header">
                <div>
                  <h3 className="run-step-timeline-title">
                    {describeRunStepKind(step.kind)}
                  </h3>
                  <p className="muted run-step-timeline-binding">
                    {step.bindingName}
                  </p>
                </div>
                <StatusChip
                  status={step.status}
                  category={stepStatusCategory(step.status)}
                  label={runExecutionStatusLabel(step.status)}
                />
              </header>
              <dl className="run-step-timeline-meta meta-grid">
                <div>
                  <dt>Started</dt>
                  <dd>{formatActivityTimestamp(step.startedAt)}</dd>
                </div>
                <div>
                  <dt>Duration</dt>
                  <dd>{formatDurationMs(step.startedAt, step.completedAt)}</dd>
                </div>
                {step.totalTokens !== undefined ? (
                  <div>
                    <dt>Tokens</dt>
                    <dd>{step.totalTokens}</dd>
                  </div>
                ) : null}
                <div>
                  <dt>Estimated cost</dt>
                  <dd>{formatUsdMicros(step.estimatedCostUsdMicros)}</dd>
                </div>
                {bindingRef !== undefined ? (
                  <div>
                    <dt>Binding ref</dt>
                    <dd className="mono">{bindingRef}</dd>
                  </div>
                ) : null}
                {step.errorCode !== undefined ? (
                  <div>
                    <dt>Error code</dt>
                    <dd className="mono">{step.errorCode}</dd>
                  </div>
                ) : null}
                {toolDiagnostics?.toolVersionId !== undefined ? (
                  <div>
                    <dt>ToolVersion</dt>
                    <dd className="mono">{toolDiagnostics.toolVersionId}</dd>
                  </div>
                ) : null}
              </dl>
              {toolDiagnostics?.guidance !== undefined ? (
                <OperatorGuidancePanel guidance={toolDiagnostics.guidance} />
              ) : null}
              {step.kind === "TOOL" &&
              toolDiagnostics?.guidance === undefined ? (
                <p className="muted">
                  Tool binding <span className="mono">{step.bindingName}</span>{" "}
                  — execution authorization is enforced by ToolGateway; this
                  step records the persisted outcome only.
                </p>
              ) : null}
            </article>
          </li>
        );
      })}
    </ol>
  );
}
