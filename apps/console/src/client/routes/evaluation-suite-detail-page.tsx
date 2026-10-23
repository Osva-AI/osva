import { Link, useParams } from "react-router-dom";

import { EmptyState } from "../components/empty-state/empty-state";
import { ErrorState } from "../components/error-state/error-state";
import { LoadingBlock } from "../components/loading/loading-block";
import { useAuthContextQuery } from "../hooks/use-auth-context";
import {
  useEvaluationSuiteQuery,
  useEvaluationSuiteVersionsQuery,
} from "../hooks/use-evaluations";
import { formatTimestamp } from "../lib/formatting";
import { ConsoleApiError } from "../lib/console-api";
import {
  roleCanExecuteControlPlaneActions,
  roleCanWriteControlPlaneResources,
} from "../lib/permissions";

export function EvaluationSuiteDetailPage() {
  const { evaluationSuiteId } = useParams<{ evaluationSuiteId: string }>();
  const authQuery = useAuthContextQuery();
  const suiteQuery = useEvaluationSuiteQuery(evaluationSuiteId);
  const versionsQuery = useEvaluationSuiteVersionsQuery(evaluationSuiteId);

  const canWrite =
    authQuery.data !== undefined &&
    roleCanWriteControlPlaneResources(authQuery.data.role);
  const canExecute =
    authQuery.data !== undefined &&
    roleCanExecuteControlPlaneActions(authQuery.data.role);

  const sortedVersions = [...(versionsQuery.data?.items ?? [])].sort(
    (left, right) => right.version - left.version,
  );
  const latestVersion = sortedVersions[0];

  const notFound =
    suiteQuery.isError &&
    suiteQuery.error instanceof ConsoleApiError &&
    suiteQuery.error.status === 404;

  if (evaluationSuiteId === undefined) {
    return (
      <ErrorState
        title="Invalid route"
        error={new Error("Missing evaluationSuiteId.")}
      />
    );
  }

  return (
    <>
      <header className="page-header">
        <div>
          <h1 className="page-title">
            {suiteQuery.data?.name ?? "Evaluation suite"}
          </h1>
          <p className="page-subtitle">
            {suiteQuery.data?.description ??
              "Published suite versions are immutable."}
          </p>
          <p className="muted mono">ID: {evaluationSuiteId}</p>
        </div>
        <div className="toolbar">
          {canWrite ? (
            <Link
              className="button primary"
              to={
                latestVersion !== undefined
                  ? `/testing/suites/${evaluationSuiteId}/versions/new?from=${encodeURIComponent(latestVersion.id)}`
                  : `/testing/suites/${evaluationSuiteId}/versions/new`
              }
            >
              {latestVersion !== undefined
                ? "Create new version"
                : "Publish first version"}
            </Link>
          ) : null}
          <Link className="button" to="/testing">
            Testing Studio
          </Link>
        </div>
      </header>

      {suiteQuery.isLoading || versionsQuery.isLoading ? (
        <LoadingBlock label="Loading evaluation suite…" />
      ) : null}
      {notFound ? (
        <EmptyState
          title="Evaluation suite not found."
          description="This suite is not visible in your workspace."
        />
      ) : null}
      {suiteQuery.isError && !notFound ? (
        <ErrorState
          title="Failed to load evaluation suite"
          error={suiteQuery.error}
        />
      ) : null}

      {suiteQuery.data !== undefined ? (
        <section className="panel">
          <dl className="meta-grid">
            <div>
              <dt>Key</dt>
              <dd className="mono">{suiteQuery.data.key}</dd>
            </div>
            <div>
              <dt>Updated</dt>
              <dd>{formatTimestamp(suiteQuery.data.updatedAt)}</dd>
            </div>
          </dl>
        </section>
      ) : null}

      <section className="panel">
        <h2 className="panel-title">Published versions</h2>
        {versionsQuery.isError ? (
          <ErrorState
            title="Failed to load versions"
            error={versionsQuery.error}
          />
        ) : null}
        {sortedVersions.length === 0 ? (
          <EmptyState
            title="No published versions yet."
            description={
              canWrite
                ? "Publish the first version to add JSON test cases."
                : "An editor must publish the first version."
            }
          />
        ) : null}
        {sortedVersions.length > 0 ? (
          <table className="data-table">
            <thead>
              <tr>
                <th>Version</th>
                <th>Cases</th>
                <th>Published</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {sortedVersions.map((version) => (
                <tr key={version.id}>
                  <td>v{version.version}</td>
                  <td>{version.cases.length}</td>
                  <td>{formatTimestamp(version.createdAt)}</td>
                  <td>
                    <div className="toolbar">
                      <Link
                        className="button button-secondary"
                        to={`/testing/suites/${evaluationSuiteId}/versions/${version.id}`}
                      >
                        View
                      </Link>
                      {canExecute && version.cases.length > 0 ? (
                        <Link
                          className="button button-secondary"
                          to={`/testing/runs/new?suiteId=${encodeURIComponent(evaluationSuiteId)}&suiteVersionId=${encodeURIComponent(version.id)}`}
                        >
                          Launch
                        </Link>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </section>
    </>
  );
}
