import { Link, useParams } from "react-router-dom";

import { EmptyState } from "../components/empty-state/empty-state";
import { ErrorState } from "../components/error-state/error-state";
import { JsonView } from "../components/json-view/json-view";
import { LoadingBlock } from "../components/loading/loading-block";
import { useAuthContextQuery } from "../hooks/use-auth-context";
import {
  useEvaluationSuiteQuery,
  useEvaluationSuiteVersionQuery,
} from "../hooks/use-evaluations";
import { formatTimestamp } from "../lib/formatting";
import { ConsoleApiError } from "../lib/console-api";
import { roleCanWriteControlPlaneResources } from "../lib/permissions";

export function EvaluationSuiteVersionPage() {
  const { evaluationSuiteId, evaluationSuiteVersionId } = useParams<{
    evaluationSuiteId: string;
    evaluationSuiteVersionId: string;
  }>();
  const authQuery = useAuthContextQuery();
  const suiteQuery = useEvaluationSuiteQuery(evaluationSuiteId);
  const versionQuery = useEvaluationSuiteVersionQuery(
    evaluationSuiteId,
    evaluationSuiteVersionId,
  );

  const canWrite =
    authQuery.data !== undefined &&
    roleCanWriteControlPlaneResources(authQuery.data.role);

  const notFound =
    versionQuery.isError &&
    versionQuery.error instanceof ConsoleApiError &&
    versionQuery.error.status === 404;

  if (
    evaluationSuiteId === undefined ||
    evaluationSuiteVersionId === undefined
  ) {
    return (
      <ErrorState
        title="Invalid route"
        error={new Error("Missing route parameters.")}
      />
    );
  }

  const sortedCases = [...(versionQuery.data?.cases ?? [])].sort(
    (left, right) => left.key.localeCompare(right.key),
  );

  return (
    <>
      <header className="page-header">
        <div>
          <h1 className="page-title">
            Suite version
            {versionQuery.data !== undefined
              ? ` v${versionQuery.data.version}`
              : ""}
          </h1>
          <p className="page-subtitle mono">{evaluationSuiteVersionId}</p>
          {suiteQuery.data !== undefined ? (
            <p className="muted">{suiteQuery.data.name}</p>
          ) : null}
        </div>
        <div className="toolbar">
          {canWrite ? (
            <Link
              className="button primary"
              to={`/testing/suites/${evaluationSuiteId}/versions/new?from=${encodeURIComponent(evaluationSuiteVersionId)}`}
            >
              Create new version
            </Link>
          ) : null}
          <Link className="button" to={`/testing/suites/${evaluationSuiteId}`}>
            Back to suite
          </Link>
        </div>
      </header>

      {versionQuery.isLoading || suiteQuery.isLoading ? (
        <LoadingBlock label="Loading suite version…" />
      ) : null}
      {notFound ? (
        <EmptyState
          title="Suite version not found."
          description="This version is not visible for the suite in your workspace."
        />
      ) : null}
      {versionQuery.isError && !notFound ? (
        <ErrorState
          title="Failed to load suite version"
          error={versionQuery.error}
        />
      ) : null}

      {versionQuery.data !== undefined ? (
        <>
          <section className="panel">
            <dl className="meta-grid">
              <div>
                <dt>Published</dt>
                <dd>{formatTimestamp(versionQuery.data.createdAt)}</dd>
              </div>
              <div>
                <dt>Cases</dt>
                <dd>{versionQuery.data.cases.length}</dd>
              </div>
              <div>
                <dt>Immutable</dt>
                <dd>Yes — published versions cannot be edited.</dd>
              </div>
            </dl>
          </section>

          <section className="panel">
            <h2 className="panel-title">Test cases</h2>
            <div className="stack" style={{ gap: 16 }}>
              {sortedCases.map((evaluationCase) => (
                <article key={evaluationCase.id} className="panel nested-panel">
                  <h3 className="panel-title mono">{evaluationCase.key}</h3>
                  {evaluationCase.name !== undefined ? (
                    <p>{evaluationCase.name}</p>
                  ) : null}
                  <div className="filters">
                    <div>
                      <h4>Test input</h4>
                      <JsonView value={evaluationCase.input} />
                    </div>
                    <div>
                      <h4>Expected output</h4>
                      <JsonView value={evaluationCase.evaluator.expected} />
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </section>
        </>
      ) : null}
    </>
  );
}
