import { Link, useParams, useSearchParams } from "react-router-dom";

import { RunArtifactsSection } from "../components/artifact/run-artifacts-section";
import { EmptyState } from "../components/empty-state/empty-state";
import { ErrorState } from "../components/error-state/error-state";
import { JsonView } from "../components/json-view/json-view";
import { LoadingBlock } from "../components/loading/loading-block";
import { OperatorGuidancePanel } from "../components/operator/operator-guidance";
import { RunStepTimeline } from "../components/run/run-step-timeline";
import { RunUsageSummary } from "../components/run/run-usage-summary";
import { StatusChip } from "../components/status/status-chip";
import {
  useArtifactsQuery,
  useRunAttemptQuery,
  useRunAttemptsQuery,
  useRunQuery,
  useRunRecoveryQuery,
  useResumeRunMutation,
  useRunStepsQuery,
  useRunUsageQuery,
} from "../hooks/use-runs";
import { shortenResourceId } from "../lib/activity-feed";
import { executionStateLabel } from "../lib/execution-diagnostics";
import {
  formatActivityTimestamp,
  formatAttemptDuration,
  formatTimestamp,
} from "../lib/formatting";
import { onboardingSearch } from "../lib/agent-onboarding";
import {
  describeRunAttemptFailureGuidance,
  describeRunLifecycleGuidance,
} from "../lib/operator-diagnostics";
import { runExecutionStatusLabel } from "../lib/run-execution-labels";
import {
  attemptStatusCategory,
  isRunLive,
  runStatusCategory,
} from "../lib/statuses";

function useRunDetailQuerySuffix(): string {
  const [searchParams] = useSearchParams();
  const query = searchParams.toString();
  return query.length > 0 ? `?${query}` : "";
}

export function RunDetailPage() {
  const { runId, runAttemptId } = useParams<{
    runId: string;
    runAttemptId?: string;
  }>();
  const [searchParams] = useSearchParams();
  const querySuffix = useRunDetailQuerySuffix();
  const fromOnboarding = searchParams.get("from") === "onboarding";

  const runQuery = useRunQuery(runId);
  const attemptsQuery = useRunAttemptsQuery(runId, runQuery.data?.status);
  const showRecovery =
    runQuery.data?.status === "INTERRUPTED" ||
    runQuery.data?.recovery !== undefined;
  const recoveryQuery = useRunRecoveryQuery(runId, showRecovery);
  const resumeRun = useResumeRunMutation(runId);

  const attempts = attemptsQuery.data?.attempts ?? [];
  const selectedAttemptId = runAttemptId ?? attempts[attempts.length - 1]?.id;

  const selectedAttemptMeta = attempts.find(
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

  const runLive =
    runQuery.data !== undefined && isRunLive(runQuery.data.status);
  const attemptLive =
    selectedAttemptMeta?.status === "PENDING" ||
    selectedAttemptMeta?.status === "RUNNING";
  const artifactsLive = runLive || attemptLive;

  const artifactsQuery = useArtifactsQuery({
    runId,
    runAttemptId: selectedAttemptId,
    live: artifactsLive,
  });

  const refreshing =
    runQuery.isFetching ||
    attemptsQuery.isFetching ||
    attemptQuery.isFetching ||
    stepsQuery.isFetching;

  function refreshAll(): void {
    void runQuery.refetch();
    void attemptsQuery.refetch();
    void attemptQuery.refetch();
    void stepsQuery.refetch();
    void usageQuery.refetch();
    void artifactsQuery.refetch();
  }

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
  const runStepCount = stepsQuery.data?.steps?.length ?? 0;
  const showFailureFirst =
    run.status === "FAILED" ||
    run.status === "TIMED_OUT" ||
    selectedAttemptForGuidance?.status === "FAILED" ||
    selectedAttemptForGuidance?.status === "TIMED_OUT";
  const failureGuidance = showFailureFirst
    ? describeRunAttemptFailureGuidance({
        error: selectedAttemptForGuidance?.error,
        execution: selectedAttemptForGuidance?.execution,
        runStepCount,
        runStatus: run.status,
        attemptStatus: selectedAttemptForGuidance?.status,
      })
    : undefined;

  const attemptUrlMissing =
    runAttemptId !== undefined &&
    attemptsQuery.data !== undefined &&
    !attempts.some((attempt) => attempt.id === runAttemptId);

  return (
    <div className="run-detail-v2 page-stack" data-testid="run-detail-v2">
      <header className="run-detail-outcome panel">
        <div className="run-detail-outcome-main">
          <div className="run-detail-outcome-headline">
            <h1 className="run-detail-title">Agent run</h1>
            <StatusChip
              status={run.status}
              category={runStatusCategory(run.status)}
              label={runExecutionStatusLabel(run.status)}
            />
            {runLive ? (
              <span className="run-detail-live muted" role="status">
                Live
              </span>
            ) : null}
          </div>
          <p className="muted run-detail-run-meta">
            <span className="mono" title={run.id}>
              {shortenResourceId(run.id)}
            </span>
            {" · "}
            Created {formatActivityTimestamp(run.createdAt)}
            {" · "}
            Updated {formatActivityTimestamp(run.updatedAt)}
          </p>
          <p className="visually-hidden">
            Individual Run (not a WorkflowRun). RunAttempts below are not
            WorkflowNodeRuns.
          </p>
        </div>
        <div className="toolbar run-detail-toolbar">
          {refreshing ? (
            <span className="muted run-detail-refresh-hint" role="status">
              Refreshing…
            </span>
          ) : null}
          {fromOnboarding || run.status !== "SUCCEEDED" ? (
            <Link className="button" to={onboardingLink}>
              Continue getting started
            </Link>
          ) : null}
          <Link className="button" to="/runs">
            Back to runs
          </Link>
          <Link className="button" to="/activity">
            Activity
          </Link>
          <button type="button" className="button" onClick={refreshAll}>
            Refresh
          </button>
        </div>
        {showRecovery && recoveryQuery.data !== undefined ? (
          <section
            className="panel run-detail-recovery"
            data-testid="run-detail-recovery"
            aria-labelledby="run-detail-recovery-title"
          >
            <h2 id="run-detail-recovery-title">Recovery</h2>
            <p className="muted">
              {recoveryQuery.data.eligible
                ? "This run can be resumed from the latest durable checkpoint."
                : (recoveryQuery.data.ineligibleMessage ??
                  "Recovery is not available for this run.")}
            </p>
            {recoveryQuery.data.latestCheckpoint !== undefined ? (
              <p className="muted">
                Latest checkpoint: phase{" "}
                <span className="mono">
                  {recoveryQuery.data.latestCheckpoint.cursorPhase}
                </span>{" "}
                (sequence{" "}
                {String(recoveryQuery.data.latestCheckpoint.checkpointSequence)}
                )
              </p>
            ) : null}
            {recoveryQuery.data.blockedOperations.length > 0 ? (
              <ul className="run-detail-recovery-blocked">
                {recoveryQuery.data.blockedOperations.map((op) => (
                  <li key={op.operationKey}>
                    <span className="mono">{op.bindingName}</span> · {op.status}{" "}
                    · {op.idempotencyClass}
                  </li>
                ))}
              </ul>
            ) : null}
            {recoveryQuery.data.eligible ? (
              <button
                type="button"
                className="button primary"
                data-testid="run-detail-resume"
                disabled={resumeRun.isPending}
                onClick={() => {
                  void resumeRun.mutateAsync().then(() => refreshAll());
                }}
              >
                {resumeRun.isPending ? "Scheduling…" : "Resume run"}
              </button>
            ) : null}
          </section>
        ) : null}
        {failureGuidance !== undefined ? (
          <section
            className="run-detail-failure-inline"
            aria-labelledby="run-detail-failure-title"
          >
            <h2
              id="run-detail-failure-title"
              className="run-detail-failure-inline-title"
            >
              What happened
            </h2>
            <OperatorGuidancePanel
              guidance={failureGuidance}
              testId="run-failure-guidance"
            />
          </section>
        ) : null}
        {lifecycleGuidance !== undefined ? (
          <OperatorGuidancePanel
            guidance={lifecycleGuidance}
            testId="run-lifecycle-guidance"
          />
        ) : null}
      </header>

      <section
        className="run-detail-context panel"
        aria-labelledby="run-detail-context-title"
      >
        <h2 id="run-detail-context-title" className="panel-title">
          Agent context
        </h2>
        <dl className="meta-grid">
          <div>
            <dt>Agent</dt>
            <dd>
              <Link className="mono" to={`/agents/${run.agentId}`}>
                {run.agentId}
              </Link>
            </dd>
          </div>
          <div>
            <dt>Agent version</dt>
            <dd>
              <Link
                className="mono"
                to={`/agents/${run.agentId}/versions/${run.effectiveBindings.agentVersionId}`}
              >
                {run.effectiveBindings.agentVersionId}
              </Link>
            </dd>
          </div>
          {run.evaluationRunId !== undefined ? (
            <div>
              <dt>Evaluation run</dt>
              <dd>
                <Link
                  className="mono"
                  to={`/testing/runs/${encodeURIComponent(run.evaluationRunId)}`}
                >
                  {run.evaluationRunId}
                </Link>
              </dd>
            </div>
          ) : null}
          {run.evaluationCaseId !== undefined ? (
            <div>
              <dt>Evaluation case</dt>
              <dd className="mono">{run.evaluationCaseId}</dd>
            </div>
          ) : null}
        </dl>
      </section>

      <section
        className="run-detail-attempts panel"
        aria-labelledby="run-detail-attempts-title"
      >
        <h2 id="run-detail-attempts-title" className="panel-title">
          Attempts
        </h2>
        {attemptsQuery.isLoading ? (
          <LoadingBlock label="Loading attempts…" />
        ) : null}
        {attemptsQuery.isError ? (
          <ErrorState
            title="Failed to load attempts"
            error={attemptsQuery.error}
          />
        ) : null}
        {attempts.length === 0 && !attemptsQuery.isLoading ? (
          <EmptyState title="No attempts yet." />
        ) : null}
        {attemptUrlMissing ? (
          <ErrorState
            title="Attempt not found"
            error={
              new Error(
                "This RunAttempt is not listed for the Run. Select another attempt or refresh.",
              )
            }
          />
        ) : null}
        {attempts.length > 0 ? (
          <div className="run-detail-attempt-list attempt-list">
            {attempts.map((attempt) => (
              <Link
                key={attempt.id}
                to={`/runs/${run.id}/attempts/${attempt.id}${querySuffix}`}
                className={`attempt-card${selectedAttemptId === attempt.id ? " selected" : ""}`}
                aria-current={
                  selectedAttemptId === attempt.id ? "true" : undefined
                }
              >
                <div className="run-detail-attempt-card-head">
                  <strong>Attempt {attempt.sequence}</strong>
                  <StatusChip
                    status={attempt.status}
                    category={attemptStatusCategory(attempt.status)}
                    label={runExecutionStatusLabel(attempt.status)}
                  />
                </div>
                <p className="muted">
                  Duration{" "}
                  {formatAttemptDuration(
                    attempt.startedAt,
                    attempt.completedAt,
                    attempt.status === "PENDING" ||
                      attempt.status === "RUNNING",
                  )}
                </p>
                <p className="mono run-detail-attempt-id" title={attempt.id}>
                  {shortenResourceId(attempt.id)}
                </p>
              </Link>
            ))}
          </div>
        ) : null}
      </section>

      {selectedAttemptId !== undefined ? (
        <>
          <section
            className="run-detail-timeline panel"
            aria-labelledby="run-detail-timeline-title"
          >
            <h2 id="run-detail-timeline-title" className="panel-title">
              Execution timeline
            </h2>
            {stepsQuery.isError ? (
              <ErrorState
                title="Failed to load activity"
                error={stepsQuery.error}
              />
            ) : (
              <RunStepTimeline
                steps={stepsQuery.data?.steps}
                isLoading={stepsQuery.isLoading}
                isLive={attemptLive}
                terminalSucceeded={
                  !attemptLive &&
                  (run.status === "SUCCEEDED" ||
                    selectedAttemptMeta?.status === "SUCCEEDED")
                }
              />
            )}
          </section>

          <section
            className="run-detail-results panel"
            aria-labelledby="run-detail-results-title"
          >
            <h2 id="run-detail-results-title" className="panel-title">
              Results
            </h2>
            <h3 className="section-title">Output</h3>
            {attemptQuery.isLoading ? (
              <LoadingBlock label="Loading attempt output…" />
            ) : null}
            {attemptQuery.isError ? (
              <ErrorState
                title="Failed to load attempt"
                error={attemptQuery.error}
              />
            ) : null}
            {attemptQuery.data?.output !== undefined ? (
              <JsonView value={attemptQuery.data.output} />
            ) : (
              <EmptyState
                title={
                  attemptLive
                    ? "Output is not ready yet."
                    : "No output recorded for this attempt."
                }
                description={
                  attemptLive
                    ? "Terminal attempts publish output when execution succeeds."
                    : undefined
                }
              />
            )}

            <RunArtifactsSection
              artifacts={artifactsQuery.data?.items}
              isLoading={artifactsQuery.isLoading}
              isError={artifactsQuery.isError}
              error={artifactsQuery.error}
              live={artifactsLive}
            />

            <h3 className="section-title">Usage</h3>
            {usageQuery.isError ? (
              <ErrorState
                title="Failed to load usage"
                error={usageQuery.error}
              />
            ) : (
              <RunUsageSummary
                usage={usageQuery.data}
                isLoading={usageQuery.isLoading}
                isError={usageQuery.isError}
              />
            )}
          </section>

          <details className="run-detail-advanced panel">
            <summary className="run-detail-advanced-summary">
              Advanced technical details
            </summary>
            <div className="run-detail-advanced-body">
              <h3 className="section-title">Run input</h3>
              <JsonView value={run.input} />

              <h3 className="section-title">Effective bindings</h3>
              <JsonView
                label="Bindings"
                value={{
                  agentVersionId: run.effectiveBindings.agentVersionId,
                  modelProfileVersionBindings:
                    run.effectiveBindings.modelProfileVersionBindings,
                  toolVersionBindings:
                    run.effectiveBindings.toolVersionBindings,
                }}
              />

              {attemptQuery.data !== undefined ? (
                <>
                  <h3 className="section-title">RunAttempt</h3>
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
                      <dt>Attempt status</dt>
                      <dd>
                        <StatusChip
                          status={attemptQuery.data.status}
                          category={attemptStatusCategory(
                            attemptQuery.data.status,
                          )}
                          label={runExecutionStatusLabel(
                            attemptQuery.data.status,
                          )}
                        />
                      </dd>
                    </div>
                    <div>
                      <dt>Started</dt>
                      <dd>{formatTimestamp(attemptQuery.data.startedAt)}</dd>
                    </div>
                    <div>
                      <dt>Completed</dt>
                      <dd>{formatTimestamp(attemptQuery.data.completedAt)}</dd>
                    </div>
                  </dl>

                  {attemptQuery.data.execution !== undefined ? (
                    <div data-testid="execution-diagnostics">
                      <h3 className="section-title">Execution diagnostics</h3>
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
                        Lease timestamps are persisted PostgreSQL state.
                        Recovery eligibility uses PostgreSQL <code>now()</code>,
                        not this browser clock or worker process time. An
                        expired lease is not proof that a worker is down.
                      </p>
                    </div>
                  ) : null}

                  {attemptQuery.data.error !== undefined ? (
                    <JsonView label="Error" value={attemptQuery.data.error} />
                  ) : null}
                </>
              ) : null}
            </div>
          </details>
        </>
      ) : null}
    </div>
  );
}
