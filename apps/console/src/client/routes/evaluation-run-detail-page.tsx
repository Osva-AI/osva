import { useMemo } from "react";
import { Link, useParams } from "react-router-dom";

import {
  buildEvaluationCaseRows,
  EvaluationCaseResultsTable,
} from "../components/evaluation/evaluation-case-results-table";
import { EmptyState } from "../components/empty-state/empty-state";
import { ErrorState } from "../components/error-state/error-state";
import { LoadingBlock } from "../components/loading/loading-block";
import { StatusChip } from "../components/status/status-chip";
import {
  useEvaluationCaseResultsQuery,
  useEvaluationRunQuery,
  useResolvedEvaluationSuiteVersionQuery,
} from "../hooks/use-evaluations";
import {
  formatEvaluationRunInputTokens,
  formatEvaluationRunOutputTokens,
  formatEvaluationRunPricedCost,
  formatEvaluationRunUnpricedModelCalls,
  evaluationRunUsageSummaryIsMeasured,
  EVALUATION_RUN_USAGE_PENDING_LABEL,
} from "../lib/evaluation-run-usage-display";
import { formatTimestamp, formatDurationMs } from "../lib/formatting";
import {
  evaluationRunStatusCategory,
  formatPassRate,
  isEvaluationRunLive,
} from "../lib/evaluation-run-status";
import { ConsoleApiError } from "../lib/console-api";

export function EvaluationRunDetailPage() {
  const { evaluationRunId } = useParams<{ evaluationRunId: string }>();

  const runQuery = useEvaluationRunQuery(evaluationRunId);
  const caseResultsQuery = useEvaluationCaseResultsQuery(
    evaluationRunId,
    runQuery.data?.status,
  );
  const suiteVersionQuery = useResolvedEvaluationSuiteVersionQuery(
    runQuery.data?.evaluationSuiteVersionId,
  );

  const rows = useMemo(() => {
    if (
      suiteVersionQuery.data === undefined ||
      runQuery.data === undefined ||
      caseResultsQuery.data === undefined
    ) {
      return [];
    }
    return buildEvaluationCaseRows({
      cases: suiteVersionQuery.data.version.cases,
      results: caseResultsQuery.data.items,
      evaluationRunStatus: runQuery.data.status,
      summaryPendingCases: runQuery.data.summary.pendingCases,
    });
  }, [suiteVersionQuery.data, runQuery.data, caseResultsQuery.data]);

  if (evaluationRunId === undefined) {
    return (
      <ErrorState
        title="Invalid route"
        error={new Error("Missing evaluationRunId.")}
      />
    );
  }

  const notFound =
    runQuery.isError &&
    runQuery.error instanceof ConsoleApiError &&
    runQuery.error.status === 404;

  if (runQuery.isLoading) {
    return <LoadingBlock label="Loading evaluation run…" />;
  }

  if (notFound) {
    return (
      <EmptyState
        title="Evaluation run not found."
        description="This run is not visible in your workspace."
      />
    );
  }

  if (runQuery.isError) {
    return (
      <ErrorState
        title="Failed to load evaluation run"
        error={runQuery.error}
      />
    );
  }

  const evaluationRun = runQuery.data;
  if (evaluationRun === undefined) {
    return <LoadingBlock label="Loading evaluation run…" />;
  }

  const summary = evaluationRun.summary;
  const durationLabel =
    summary.durationMs !== undefined
      ? `${summary.durationMs} ms`
      : formatDurationMs(evaluationRun.startedAt, evaluationRun.completedAt);

  return (
    <>
      <header className="page-header">
        <div>
          <h1 className="page-title">Evaluation run</h1>
          <p className="page-subtitle mono">{evaluationRun.id}</p>
          {suiteVersionQuery.data !== undefined ? (
            <p className="muted">
              {suiteVersionQuery.data.suite.name} — v
              {suiteVersionQuery.data.version.version}
            </p>
          ) : null}
        </div>
        <div className="toolbar">
          <Link className="button" to="/testing">
            Testing Studio
          </Link>
          <button
            type="button"
            className="button button-secondary"
            disabled={runQuery.isFetching || caseResultsQuery.isFetching}
            onClick={() => {
              void runQuery.refetch();
              void caseResultsQuery.refetch();
              void suiteVersionQuery.refetch();
            }}
          >
            Refresh
          </button>
        </div>
      </header>

      {isEvaluationRunLive(evaluationRun.status) ? (
        <p className="muted">Live progress updates every few seconds.</p>
      ) : null}

      <section className="panel">
        <h2 className="panel-title">Run status</h2>
        <dl className="meta-grid">
          <div>
            <dt>Status</dt>
            <dd>
              <StatusChip
                status={evaluationRun.status}
                category={evaluationRunStatusCategory(evaluationRun.status)}
              />
            </dd>
          </div>
          <div>
            <dt>Suite version</dt>
            <dd className="mono">{evaluationRun.evaluationSuiteVersionId}</dd>
          </div>
          <div>
            <dt>Target</dt>
            <dd className="mono">
              {evaluationRun.targetType} {evaluationRun.targetVersionId}
            </dd>
          </div>
          <div>
            <dt>Started</dt>
            <dd>{formatTimestamp(evaluationRun.startedAt)}</dd>
          </div>
          <div>
            <dt>Completed</dt>
            <dd>{formatTimestamp(evaluationRun.completedAt)}</dd>
          </div>
          <div>
            <dt>Duration</dt>
            <dd>{durationLabel}</dd>
          </div>
        </dl>
      </section>

      <section className="panel">
        <h2 className="panel-title">Aggregate results</h2>
        <dl className="meta-grid">
          <div>
            <dt>Total cases</dt>
            <dd>{summary.totalCases}</dd>
          </div>
          <div>
            <dt>Pending</dt>
            <dd>{summary.pendingCases}</dd>
          </div>
          <div>
            <dt>Running</dt>
            <dd>{summary.runningCases}</dd>
          </div>
          <div>
            <dt>Completed</dt>
            <dd>{summary.completedCases}</dd>
          </div>
          <div>
            <dt>PASS</dt>
            <dd>{summary.passedCases}</dd>
          </div>
          <div>
            <dt>FAIL</dt>
            <dd>{summary.failedCases}</dd>
          </div>
          <div>
            <dt>ERROR</dt>
            <dd>{summary.errorCases}</dd>
          </div>
          <div>
            <dt>Pass rate</dt>
            <dd>{formatPassRate(summary.passRate)}</dd>
          </div>
          <div>
            <dt>Input tokens</dt>
            <dd
              className={
                evaluationRunUsageSummaryIsMeasured(summary)
                  ? undefined
                  : "muted"
              }
            >
              {formatEvaluationRunInputTokens(summary)}
            </dd>
          </div>
          <div>
            <dt>Output tokens</dt>
            <dd
              className={
                evaluationRunUsageSummaryIsMeasured(summary)
                  ? undefined
                  : "muted"
              }
            >
              {formatEvaluationRunOutputTokens(summary)}
            </dd>
          </div>
          <div>
            <dt>Priced cost</dt>
            <dd
              className={
                evaluationRunUsageSummaryIsMeasured(summary)
                  ? undefined
                  : "muted"
              }
            >
              {formatEvaluationRunPricedCost(summary)}
            </dd>
          </div>
          <div>
            <dt>Unpriced model calls</dt>
            <dd
              className={
                evaluationRunUsageSummaryIsMeasured(summary)
                  ? undefined
                  : "muted"
              }
            >
              {formatEvaluationRunUnpricedModelCalls(summary)}
            </dd>
          </div>
        </dl>
        {!evaluationRunUsageSummaryIsMeasured(summary) ? (
          <p className="muted">{EVALUATION_RUN_USAGE_PENDING_LABEL}</p>
        ) : null}
        <p className="muted">
          Batch status reflects orchestration progress. Individual case outcomes
          may be PASS, FAIL, or ERROR while the run is still{" "}
          {evaluationRun.status}.
        </p>
      </section>

      <section className="panel">
        <h2 className="panel-title">Case results</h2>
        {suiteVersionQuery.isLoading ? (
          <LoadingBlock label="Loading suite cases…" />
        ) : null}
        {suiteVersionQuery.isError ? (
          <ErrorState
            title="Failed to resolve suite version"
            error={suiteVersionQuery.error}
          />
        ) : null}
        {caseResultsQuery.isLoading && caseResultsQuery.data === undefined ? (
          <LoadingBlock label="Loading case results…" />
        ) : null}
        {caseResultsQuery.isError ? (
          <ErrorState
            title="Failed to load case results"
            error={caseResultsQuery.error}
          />
        ) : null}
        {suiteVersionQuery.data !== undefined &&
        caseResultsQuery.data !== undefined ? (
          <EvaluationCaseResultsTable rows={rows} />
        ) : null}
      </section>
    </>
  );
}
