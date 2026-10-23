import { useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";

import { EmptyState } from "../components/empty-state/empty-state";
import { ErrorState } from "../components/error-state/error-state";
import { LoadingBlock } from "../components/loading/loading-block";
import { useAuthContextQuery } from "../hooks/use-auth-context";
import { useAgentsListQuery, useAgentVersionsQuery } from "../hooks/use-agents";
import {
  useEvaluationSuiteVersionsQuery,
  useEvaluationSuitesQuery,
  useLaunchEvaluationRunMutation,
} from "../hooks/use-evaluations";
import { uniqueEvaluatorTypes } from "../lib/evaluation-case-expected";
import {
  validateEvaluationLaunchDraft,
  type EvaluationLaunchValidationIssue,
} from "../lib/evaluation-launch-validation";
import { ConsoleApiError } from "../lib/console-api";
import { roleCanExecuteControlPlaneActions } from "../lib/permissions";

export function EvaluationRunLaunchPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const submittingRef = useRef(false);

  const authQuery = useAuthContextQuery();
  const canExecute =
    authQuery.data !== undefined &&
    roleCanExecuteControlPlaneActions(authQuery.data.role);

  const [evaluationSuiteId, setEvaluationSuiteId] = useState(
    searchParams.get("suiteId") ?? "",
  );
  const [evaluationSuiteVersionId, setEvaluationSuiteVersionId] = useState(
    searchParams.get("suiteVersionId") ?? "",
  );
  const [agentId, setAgentId] = useState(searchParams.get("agentId") ?? "");
  const [agentVersionId, setAgentVersionId] = useState(
    searchParams.get("agentVersionId") ?? "",
  );
  const [submitError, setSubmitError] = useState<string | undefined>();
  const [errorRequestId, setErrorRequestId] = useState<string | undefined>();

  const suitesQuery = useEvaluationSuitesQuery();
  const versionsQuery = useEvaluationSuiteVersionsQuery(
    evaluationSuiteId.length > 0 ? evaluationSuiteId : undefined,
  );
  const agentsQuery = useAgentsListQuery();
  const agentVersionsQuery = useAgentVersionsQuery(
    agentId.length > 0 ? agentId : undefined,
  );
  const launchMutation = useLaunchEvaluationRunMutation();

  const selectedVersion = versionsQuery.data?.items.find(
    (version) => version.id === evaluationSuiteVersionId,
  );
  const selectedSuite = suitesQuery.data?.items.find(
    (suite) => suite.id === evaluationSuiteId,
  );
  const selectedAgent = agentsQuery.data?.agents.find(
    (agent) => agent.id === agentId,
  );
  const selectedAgentVersion = agentVersionsQuery.data?.versions.find(
    (version) => version.id === agentVersionId,
  );

  const caseCount = selectedVersion?.cases.length ?? 0;
  const evaluatorTypes = useMemo(
    () => uniqueEvaluatorTypes(selectedVersion?.cases ?? []),
    [selectedVersion?.cases],
  );

  const validationIssues = useMemo(
    () =>
      validateEvaluationLaunchDraft({
        evaluationSuiteId,
        evaluationSuiteVersionId,
        agentId,
        agentVersionId,
        caseCount,
      }),
    [
      evaluationSuiteId,
      evaluationSuiteVersionId,
      agentId,
      agentVersionId,
      caseCount,
    ],
  );

  const issuesByField = useMemo(() => {
    const map = new Map<string, string>();
    for (const issue of validationIssues) {
      map.set(issue.field, issue.message);
    }
    return map;
  }, [validationIssues]);

  async function handleLaunch() {
    if (!canExecute || validationIssues.length > 0 || submittingRef.current) {
      return;
    }
    submittingRef.current = true;
    setSubmitError(undefined);
    setErrorRequestId(undefined);
    try {
      const created = await launchMutation.mutateAsync({
        evaluationSuiteVersionId,
        targetVersionId: agentVersionId,
      });
      navigate(`/testing/runs/${created.id}`);
    } catch (error) {
      if (error instanceof ConsoleApiError) {
        setSubmitError(error.message);
        setErrorRequestId(error.body.requestId);
      } else if (error instanceof Error) {
        setSubmitError(error.message);
      } else {
        setSubmitError("Failed to launch evaluation.");
      }
    } finally {
      submittingRef.current = false;
    }
  }

  function fieldError(field: EvaluationLaunchValidationIssue["field"]) {
    return issuesByField.get(field);
  }

  return (
    <>
      <header className="page-header">
        <div>
          <h1 className="page-title">Launch batch evaluation</h1>
          <p className="page-subtitle">
            Run every case in an immutable EvaluationSuiteVersion against a
            published AgentVersion.
          </p>
        </div>
        <Link className="button button-secondary" to="/testing">
          Back to Testing Studio
        </Link>
      </header>

      {!canExecute ? (
        <section className="panel">
          <p className="error-text">
            Your workspace role cannot EXECUTE evaluations. Ask an admin to
            grant execution permission.
          </p>
        </section>
      ) : null}

      {suitesQuery.isLoading || agentsQuery.isLoading ? (
        <LoadingBlock label="Loading launch options…" />
      ) : null}
      {suitesQuery.isError ? (
        <ErrorState
          title="Failed to load evaluation suites"
          error={suitesQuery.error}
        />
      ) : null}
      {agentsQuery.isError ? (
        <ErrorState title="Failed to load agents" error={agentsQuery.error} />
      ) : null}

      {canExecute &&
      suitesQuery.data?.items.length === 0 &&
      !suitesQuery.isLoading ? (
        <EmptyState
          title="No evaluation suites yet."
          description="Publish a suite version before launching a batch evaluation."
        />
      ) : null}

      {canExecute ? (
        <section className="panel">
          <h2 className="panel-title">Selections</h2>
          <div className="stack" style={{ gap: 16, maxWidth: 560 }}>
            <div className="field">
              <label htmlFor="launch-suite">Evaluation suite</label>
              <select
                id="launch-suite"
                value={evaluationSuiteId}
                onChange={(event) => {
                  setEvaluationSuiteId(event.target.value);
                  setEvaluationSuiteVersionId("");
                }}
              >
                <option value="">Select a suite…</option>
                {(suitesQuery.data?.items ?? []).map((suite) => (
                  <option key={suite.id} value={suite.id}>
                    {suite.name} ({suite.key})
                  </option>
                ))}
              </select>
              {fieldError("evaluationSuiteId") !== undefined ? (
                <p className="field-error">{fieldError("evaluationSuiteId")}</p>
              ) : null}
            </div>

            <div className="field">
              <label htmlFor="launch-suite-version">Published version</label>
              <select
                id="launch-suite-version"
                value={evaluationSuiteVersionId}
                disabled={evaluationSuiteId.length === 0}
                onChange={(event) => {
                  setEvaluationSuiteVersionId(event.target.value);
                }}
              >
                <option value="">Select a version…</option>
                {(versionsQuery.data?.items ?? [])
                  .slice()
                  .sort((left, right) => right.version - left.version)
                  .map((version) => (
                    <option key={version.id} value={version.id}>
                      v{version.version} — {version.cases.length} case
                      {version.cases.length === 1 ? "" : "s"}
                    </option>
                  ))}
              </select>
              {versionsQuery.isLoading ? (
                <p className="muted">Loading versions…</p>
              ) : null}
              {fieldError("evaluationSuiteVersionId") !== undefined ? (
                <p className="field-error">
                  {fieldError("evaluationSuiteVersionId")}
                </p>
              ) : null}
              {fieldError("cases") !== undefined ? (
                <p className="field-error">{fieldError("cases")}</p>
              ) : null}
            </div>

            <div className="field">
              <label htmlFor="launch-agent">Agent</label>
              <select
                id="launch-agent"
                value={agentId}
                onChange={(event) => {
                  setAgentId(event.target.value);
                  setAgentVersionId("");
                }}
              >
                <option value="">Select an agent…</option>
                {(agentsQuery.data?.agents ?? []).map((agent) => (
                  <option key={agent.id} value={agent.id}>
                    {agent.name} ({agent.key})
                  </option>
                ))}
              </select>
              {fieldError("agentId") !== undefined ? (
                <p className="field-error">{fieldError("agentId")}</p>
              ) : null}
            </div>

            <div className="field">
              <label htmlFor="launch-agent-version">AgentVersion</label>
              <select
                id="launch-agent-version"
                value={agentVersionId}
                disabled={agentId.length === 0}
                onChange={(event) => {
                  setAgentVersionId(event.target.value);
                }}
              >
                <option value="">Select a version…</option>
                {(agentVersionsQuery.data?.versions ?? []).map((version) => (
                  <option key={version.id} value={version.id}>
                    v{version.version} — {version.id}
                  </option>
                ))}
              </select>
              {agentVersionsQuery.isLoading ? (
                <p className="muted">Loading AgentVersions…</p>
              ) : null}
              {fieldError("agentVersionId") !== undefined ? (
                <p className="field-error">{fieldError("agentVersionId")}</p>
              ) : null}
            </div>
          </div>
        </section>
      ) : null}

      {canExecute && selectedVersion !== undefined ? (
        <section className="panel">
          <h2 className="panel-title">Launch summary</h2>
          <dl className="meta-grid">
            <div>
              <dt>Suite</dt>
              <dd>
                {selectedSuite?.name ?? evaluationSuiteId}
                {selectedVersion !== undefined
                  ? ` — v${selectedVersion.version}`
                  : ""}
              </dd>
            </div>
            <div>
              <dt>Cases</dt>
              <dd>{caseCount}</dd>
            </div>
            <div>
              <dt>AgentVersion</dt>
              <dd className="mono">
                {selectedAgent?.name !== undefined
                  ? `${selectedAgent.name} — `
                  : ""}
                {selectedAgentVersion !== undefined
                  ? `v${selectedAgentVersion.version} (${agentVersionId})`
                  : agentVersionId.length > 0
                    ? agentVersionId
                    : "—"}
              </dd>
            </div>
            <div>
              <dt>Evaluators</dt>
              <dd>
                {evaluatorTypes.length > 0 ? evaluatorTypes.join(", ") : "—"}
              </dd>
            </div>
          </dl>
          <p className="muted">
            Launching executes real agent Runs for every case. Model and tool
            usage may incur cost in your environment.
          </p>
          {submitError !== undefined ? (
            <p className="error-text" role="alert">
              {submitError}
              {errorRequestId !== undefined ? (
                <>
                  {" "}
                  <span className="mono">Request ID: {errorRequestId}</span>
                </>
              ) : null}
            </p>
          ) : null}
          <button
            type="button"
            className="button primary"
            disabled={
              !canExecute ||
              validationIssues.length > 0 ||
              launchMutation.isPending
            }
            onClick={() => {
              void handleLaunch();
            }}
          >
            {launchMutation.isPending ? "Launching…" : "Launch evaluation"}
          </button>
        </section>
      ) : null}
    </>
  );
}
