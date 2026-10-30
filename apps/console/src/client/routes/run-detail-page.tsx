import { Link, useParams, useSearchParams } from "react-router-dom";

import { RunArtifactsSection } from "../components/artifact/run-artifacts-section";
import { EmptyState } from "../components/empty-state/empty-state";
import { ErrorState } from "../components/error-state/error-state";
import { JsonView } from "../components/json-view/json-view";
import { LoadingBlock } from "../components/loading/loading-block";
import { StatusChip } from "../components/status/status-chip";
import {
  useArtifactsQuery,
  useRunAttemptQuery,
  useRunAttemptsQuery,
  useRunQuery,
  useRunStepsQuery,
  useRunUsageQuery,
} from "../hooks/use-runs";
import {
  formatDurationMs,
  formatTimestamp,
  formatUsdMicros,
} from "../lib/formatting";
import { executionStateLabel } from "../lib/execution-diagnostics";
import {
  describeRunAttemptFailureGuidance,
  describeRunLifecycleGuidance,
} from "../lib/operator-diagnostics";
import { attemptStatusCategory, runStatusCategory } from "../lib/statuses";
import { OperatorGuidancePanel } from "../components/operator/operator-guidance";
import { onboardingSearch } from "../lib/agent-onboarding";

export function RunDetailPage() {
  const { runId, runAttemptId } = useParams<{
    runId: string;
    runAttemptId?: string;
  }>();
  const [searchParams] = useSearchParams();
  const fromOnboarding = searchParams.get("from") === "onboarding";

  const runQuery = useRunQuery(runId);
  const attemptsQuery = useRunAttemptsQuery(runId, runQuery.data?.status);

  const selectedAttemptId =
    runAttemptId ??
    attemptsQuery.data?.attempts[attemptsQuery.data.attempts.length - 1]?.id;

  const selectedAttemptMeta = attemptsQuery.data?.attempts.find(
    (attempt) => attempt.id === selectedAttemptId,
  );

  const attemptQuery = useRunAttemptQuery(
    runId,
    selectedAttemptId,
    selectedAttemptMeta?.status,
  );
  const stepsQuery = useRunStepsQuery(
    runId,
    selectedAttemptId,
    selectedAttemptMeta?.status,
  );
  const usageQuery = useRunUsageQuery(
    runId,
    selectedAttemptId,
    selectedAttemptMeta?.status,
  );
  const artifactsQuery = useArtifactsQuery({
    runId,
    runAttemptId: selectedAttemptId,
    live:
      selectedAttemptMeta?.status === "PENDING" ||
      selectedAttemptMeta?.status === "RUNNING" ||
      runQuery.data?.status === "PENDING" ||
      runQuery.data?.status === "QUEUED" ||
      runQuery.data?.status === "RUNNING",
  });

  if (runQuery.isLoading) {
    return <LoadingBlock label="Loading run…" />;
  }

  if (runQuery.isError) {
    return <ErrorState title="Failed to load run" error={runQuery.error} />;
  }

  const run = runQuery.data;
  if (run === undefined) {
    return <LoadingBlock label="Loading run…" />;
  }

  const onboardingLink = `/onboarding${onboardingSearch({
    agentId: searchParams.get("agentId") ?? run.agentId,
    agentVersionId:
      searchParams.get("agentVersionId") ??
      run.effectiveBindings.agentVersionId,
    runId: run.id,
  })}`;

  const selectedAttemptForGuidance = attemptQuery.data;
  const lifecycleGuidance = describeRunLifecycleGuidance({
    runStatus: run.status,
    attemptStatus: selectedAttemptMeta?.status,
    execution: selectedAttemptForGuidance?.execution,
  });
  const failureGuidance =
    selectedAttemptForGuidance?.status === "FAILED" || run.status === "FAILED"
      ? describeRunAttemptFailureGuidance({
          error: selectedAttemptForGuidance?.error,
          execution: selectedAttemptForGuidance?.execution,
        })
      : undefined;

  return (
    <>
      <header className="page-header">
        <div>
          <h1 className="page-title">Run</h1>
          <p className="page-subtitle mono">{run.id}</p>
          <p className="muted">
            Individual Run (not a WorkflowRun). Attempts below are RunAttempts,
            not WorkflowNodeRuns.
          </p>
        </div>
        <div className="toolbar">
          {fromOnboarding || run.status !== "SUCCEEDED" ? (
            <Link className="button" to={onboardingLink}>
              Continue getting started
            </Link>
          ) : null}
          <Link className="button" to="/runs">
            Back to runs
          </Link>
          <button
            type="button"
            className="button"
            onClick={() => {
              void runQuery.refetch();
              void attemptsQuery.refetch();
              void attemptQuery.refetch();
              void stepsQuery.refetch();
              void usageQuery.refetch();
              void artifactsQuery.refetch();
            }}
          >
            Refresh
          </button>
        </div>
      </header>

      <section className="panel">
        <dl className="meta-grid">
          <div>
            <dt>Status</dt>
            <dd>
              <StatusChip
                status={run.status}
                category={runStatusCategory(run.status)}
              />
            </dd>
          </div>
          <div>
            <dt>Agent ID</dt>
            <dd>
              <Link className="mono" to={`/agents/${run.agentId}`}>
                {run.agentId}
              </Link>
            </dd>
          </div>
          <div>
            <dt>Agent version ID</dt>
            <dd>
              <Link
                className="mono"
                to={`/agents/${run.agentId}/versions/${run.effectiveBindings.agentVersionId}`}
              >
                {run.effectiveBindings.agentVersionId}
              </Link>
            </dd>
          </div>
          <div>
            <dt>Created</dt>
            <dd>{formatTimestamp(run.createdAt)}</dd>
          </div>
          <div>
            <dt>Updated</dt>
            <dd>{formatTimestamp(run.updatedAt)}</dd>
          </div>
          {run.evaluationRunId !== undefined ? (
            <div>
              <dt>Evaluation run ID</dt>
              <dd className="mono">{run.evaluationRunId}</dd>
            </div>
          ) : null}
          {run.evaluationCaseId !== undefined ? (
            <div>
              <dt>Evaluation case ID</dt>
              <dd className="mono">{run.evaluationCaseId}</dd>
            </div>
          ) : null}
        </dl>
        {lifecycleGuidance !== undefined ? (
          <OperatorGuidancePanel
            guidance={lifecycleGuidance}
            testId="run-lifecycle-guidance"
          />
        ) : null}
      </section>

      <section className="panel">
        <h2 className="panel-title">Effective bindings</h2>
        <JsonView
          label="Bindings"
          value={{
            agentVersionId: run.effectiveBindings.agentVersionId,
            modelProfileVersionBindings:
              run.effectiveBindings.modelProfileVersionBindings,
            toolVersionBindings: run.effectiveBindings.toolVersionBindings,
          }}
        />
      </section>

      <section className="panel">
        <h2 className="panel-title">Input</h2>
        <JsonView value={run.input} />
      </section>

      <section className="panel">
        <h2 className="panel-title">Attempts</h2>
        {attemptsQuery.isLoading ? (
          <LoadingBlock label="Loading attempts…" />
        ) : null}
        {attemptsQuery.isError ? (
          <ErrorState
            title="Failed to load attempts"
            error={attemptsQuery.error}
          />
        ) : null}
        {attemptsQuery.data?.attempts.length === 0 ? (
          <EmptyState title="No attempts yet." />
        ) : null}
        {attemptsQuery.data !== undefined &&
        attemptsQuery.data.attempts.length > 0 ? (
          <div className="attempt-list">
            {attemptsQuery.data.attempts.map((attempt) => (
              <Link
                key={attempt.id}
                to={`/runs/${run.id}/attempts/${attempt.id}`}
                className={`attempt-card${selectedAttemptId === attempt.id ? " selected" : ""}`}
              >
                <div
                  className="toolbar"
                  style={{ justifyContent: "space-between" }}
                >
                  <strong className="mono">#{attempt.sequence}</strong>
                  <StatusChip
                    status={attempt.status}
                    category={attemptStatusCategory(attempt.status)}
                  />
                </div>
                <div className="mono">{attempt.id}</div>
                <div>
                  Created {formatTimestamp(attempt.createdAt)} · Started{" "}
                  {formatTimestamp(attempt.startedAt)} · Completed{" "}
                  {formatTimestamp(attempt.completedAt)}
                </div>
                <div>
                  Duration{" "}
                  {formatDurationMs(attempt.startedAt, attempt.completedAt)}
                </div>
                {attempt.error !== undefined ? (
                  <div className="mono">
                    {attempt.error.code}: {attempt.error.message}
                  </div>
                ) : null}
              </Link>
            ))}
          </div>
        ) : null}
      </section>

      {selectedAttemptId !== undefined ? (
        <>
          <section className="panel">
            <h2 className="panel-title">Run attempt</h2>
            {attemptQuery.isLoading ? (
              <LoadingBlock label="Loading attempt…" />
            ) : null}
            {attemptQuery.isError ? (
              <ErrorState
                title="Failed to load attempt"
                error={attemptQuery.error}
              />
            ) : null}
            {attemptQuery.data !== undefined ? (
              <>
                <dl className="meta-grid">
                  <div>
                    <dt>RunAttempt ID</dt>
                    <dd className="mono">{attemptQuery.data.id}</dd>
                  </div>
                  <div>
                    <dt>Sequence</dt>
                    <dd>{attemptQuery.data.sequence}</dd>
                  </div>
                  <div>
                    <dt>Status</dt>
                    <dd>
                      <StatusChip
                        status={attemptQuery.data.status}
                        category={attemptStatusCategory(
                          attemptQuery.data.status,
                        )}
                      />
                    </dd>
                  </div>
                  <div>
                    <dt>Duration</dt>
                    <dd>
                      {formatDurationMs(
                        attemptQuery.data.startedAt,
                        attemptQuery.data.completedAt,
                      )}
                    </dd>
                  </div>
                </dl>
                {attemptQuery.data.execution !== undefined ? (
                  <div data-testid="execution-diagnostics">
                    <h3 className="panel-title">Execution diagnostics</h3>
                    <dl className="meta-grid">
                      <div>
                        <dt>Execution state</dt>
                        <dd>
                          {executionStateLabel(
                            attemptQuery.data.execution.state,
                          )}
                        </dd>
                      </div>
                      <div>
                        <dt>Leased</dt>
                        <dd>
                          {attemptQuery.data.execution.leased ? "Yes" : "No"}
                        </dd>
                      </div>
                      <div>
                        <dt>Lease expires</dt>
                        <dd>
                          {formatTimestamp(
                            attemptQuery.data.execution.leaseExpiresAt,
                          )}
                        </dd>
                      </div>
                      <div>
                        <dt>Execution generation</dt>
                        <dd>
                          {attemptQuery.data.execution.executionGeneration}
                        </dd>
                      </div>
                      <div>
                        <dt>Interrupted</dt>
                        <dd>
                          {attemptQuery.data.execution.interrupted
                            ? "Yes"
                            : "No"}
                        </dd>
                      </div>
                      <div>
                        <dt>Recovery reason</dt>
                        <dd className="mono">
                          {attemptQuery.data.execution.recoveryReason ?? "—"}
                        </dd>
                      </div>
                      <div>
                        <dt>Observed at</dt>
                        <dd>
                          {formatTimestamp(
                            attemptQuery.data.execution.observedAt,
                          )}
                        </dd>
                      </div>
                    </dl>
                    <p className="muted">
                      Lease timestamps are persisted PostgreSQL state. Recovery
                      eligibility uses PostgreSQL <code>now()</code>, not this
                      browser clock or worker process time. An expired lease is
                      not proof that a worker is down.
                    </p>
                  </div>
                ) : null}
                {failureGuidance !== undefined ? (
                  <OperatorGuidancePanel
                    guidance={failureGuidance}
                    testId="run-failure-guidance"
                  />
                ) : null}
                {attemptQuery.data.error !== undefined ? (
                  <JsonView label="Error" value={attemptQuery.data.error} />
                ) : null}
                {attemptQuery.data.output !== undefined ? (
                  <JsonView label="Output" value={attemptQuery.data.output} />
                ) : (
                  <EmptyState title="No output recorded yet." />
                )}
              </>
            ) : null}
          </section>

          <section className="panel">
            <h2 className="panel-title">Activity</h2>
            {stepsQuery.isLoading ? (
              <LoadingBlock label="Loading run steps…" />
            ) : null}
            {stepsQuery.isError ? (
              <ErrorState
                title="Failed to load activity"
                error={stepsQuery.error}
              />
            ) : null}
            {stepsQuery.data?.steps.length === 0 ? (
              <EmptyState title="No RunSteps persisted yet." />
            ) : null}
            {stepsQuery.data !== undefined &&
            stepsQuery.data.steps.length > 0 ? (
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Kind</th>
                    <th>Binding</th>
                    <th>Status</th>
                    <th>Started</th>
                    <th>Duration</th>
                    <th>Model / tool</th>
                    <th>Tokens</th>
                    <th>Cost</th>
                    <th>Error</th>
                  </tr>
                </thead>
                <tbody>
                  {stepsQuery.data.steps.map((step) => (
                    <tr key={step.id}>
                      <td>{step.kind}</td>
                      <td className="mono">{step.bindingName}</td>
                      <td>{step.status}</td>
                      <td>{formatTimestamp(step.startedAt)}</td>
                      <td>
                        {formatDurationMs(step.startedAt, step.completedAt)}
                      </td>
                      <td className="mono">
                        {step.modelProfileVersionId ??
                          step.toolVersionId ??
                          "—"}
                      </td>
                      <td>{step.totalTokens ?? "—"}</td>
                      <td>{formatUsdMicros(step.estimatedCostUsdMicros)}</td>
                      <td className="mono">{step.errorCode ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : null}
          </section>

          <section className="panel">
            <h2 className="panel-title">Usage</h2>
            {usageQuery.isLoading ? (
              <LoadingBlock label="Loading usage…" />
            ) : null}
            {usageQuery.isError ? (
              <ErrorState
                title="Failed to load usage"
                error={usageQuery.error}
              />
            ) : null}
            {usageQuery.data !== undefined ? (
              <dl className="meta-grid">
                <div>
                  <dt>Model calls</dt>
                  <dd>{usageQuery.data.modelCalls}</dd>
                </div>
                <div>
                  <dt>Tool calls</dt>
                  <dd>{usageQuery.data.toolCalls}</dd>
                </div>
                <div>
                  <dt>Input tokens</dt>
                  <dd>{usageQuery.data.inputTokens}</dd>
                </div>
                <div>
                  <dt>Output tokens</dt>
                  <dd>{usageQuery.data.outputTokens}</dd>
                </div>
                <div>
                  <dt>Total tokens</dt>
                  <dd>{usageQuery.data.totalTokens}</dd>
                </div>
                <div>
                  <dt>Cached input tokens</dt>
                  <dd>{usageQuery.data.cachedInputTokens}</dd>
                </div>
                <div>
                  <dt>Estimated cost</dt>
                  <dd>
                    {formatUsdMicros(usageQuery.data.estimatedCostUsdMicros)}
                  </dd>
                </div>
                <div>
                  <dt>Priced model calls</dt>
                  <dd>{usageQuery.data.pricedModelCalls}</dd>
                </div>
                <div>
                  <dt>Unpriced model calls</dt>
                  <dd>{usageQuery.data.unpricedModelCalls}</dd>
                </div>
              </dl>
            ) : (
              <EmptyState title="No usage available." />
            )}
          </section>

          <RunArtifactsSection
            artifacts={artifactsQuery.data?.items}
            isLoading={artifactsQuery.isLoading}
            isError={artifactsQuery.isError}
            error={artifactsQuery.error}
            live={
              selectedAttemptMeta?.status === "PENDING" ||
              selectedAttemptMeta?.status === "RUNNING" ||
              run.status === "PENDING" ||
              run.status === "QUEUED" ||
              run.status === "RUNNING"
            }
          />
        </>
      ) : null}
    </>
  );
}
