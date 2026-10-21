import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";

import {
  useAgentQuery,
  useAgentVersionQuery,
  useAgentVersionsQuery,
  useAgentsListQuery,
  type AgentVersionResource,
} from "../../hooks/use-agents";
import {
  useCreateRunMutation,
  useRunAttemptQuery,
  useRunQuery,
} from "../../hooks/use-runs";
import {
  describeAgentRunInputSyntax,
  describeCreateRunFailure,
  resolveAgentVersionInputContract,
} from "../../lib/agent-input-contract";
import { ConsoleApiError } from "../../lib/console-api";
import {
  createPlaygroundRunDeadline,
  isPlaygroundRunDeadlineExceeded,
} from "../../lib/playground-run-deadline";
import { trySafeExampleFromJsonSchema } from "../../lib/workflow-root-input-contract";
import { parseWorkflowRunInputJson } from "../../lib/workflow-run-input";
import {
  attemptStatusCategory,
  isAttemptLive,
  isRunLive,
  runStatusCategory,
} from "../../lib/statuses";
import { EmptyState } from "../empty-state/empty-state";
import { JsonView } from "../json-view/json-view";
import { LoadingBlock } from "../loading/loading-block";
import { StatusChip } from "../status/status-chip";

export interface AgentPlaygroundPanelProps {
  readonly mode: "standalone" | "embedded";
  readonly agentId?: string;
  readonly agentVersionId?: string;
  readonly agentName?: string;
  readonly agentKey?: string;
  readonly canExecute: boolean;
}

export function AgentPlaygroundPanel({
  mode,
  agentId: fixedAgentId,
  agentVersionId: fixedAgentVersionId,
  agentName: fixedAgentName,
  agentKey: fixedAgentKey,
  canExecute,
}: AgentPlaygroundPanelProps) {
  const agentsQuery = useAgentsListQuery();
  const [selectedAgentId, setSelectedAgentId] = useState(fixedAgentId ?? "");
  const [selectedVersionId, setSelectedVersionId] = useState(
    fixedAgentVersionId ?? "",
  );
  const [restrictPersistentMemory, setRestrictPersistentMemory] =
    useState(true);
  const [inputText, setInputText] = useState("{}");
  const [inputTouched, setInputTouched] = useState(false);
  const [activeRunId, setActiveRunId] = useState<string | undefined>();
  const [activeAttemptId, setActiveAttemptId] = useState<string | undefined>();
  const [pollDeadlineMs, setPollDeadlineMs] = useState<number | undefined>();
  const [feedback, setFeedback] = useState<string | undefined>();
  const [errorRequestId, setErrorRequestId] = useState<string | undefined>();
  const [errorStatus, setErrorStatus] = useState<number | undefined>();
  const submittingRef = useRef(false);

  const agentId = mode === "embedded" ? (fixedAgentId ?? "") : selectedAgentId;
  const agentVersionId =
    mode === "embedded" ? (fixedAgentVersionId ?? "") : selectedVersionId;

  useEffect(() => {
    if (mode === "embedded") {
      return;
    }
    if (fixedAgentId !== undefined) {
      setSelectedAgentId(fixedAgentId);
    }
    if (fixedAgentVersionId !== undefined) {
      setSelectedVersionId(fixedAgentVersionId);
    }
  }, [fixedAgentId, fixedAgentVersionId, mode]);

  const agentQuery = useAgentQuery(agentId.length > 0 ? agentId : undefined);
  const versionsQuery = useAgentVersionsQuery(
    agentId.length > 0 ? agentId : undefined,
  );
  const versionQuery = useAgentVersionQuery(agentId, agentVersionId);
  const createRun = useCreateRunMutation();

  const selectedVersion: AgentVersionResource | undefined =
    versionQuery.data ??
    versionsQuery.data?.versions.find(
      (version) => version.id === agentVersionId,
    );

  const contract = resolveAgentVersionInputContract(
    agentId,
    agentVersionId,
    selectedVersion,
    { loading: versionQuery.isLoading },
  );

  useEffect(() => {
    if (inputTouched || contract.status !== "available") {
      return;
    }
    const example = trySafeExampleFromJsonSchema(contract.schema);
    if (example === undefined) {
      return;
    }
    setInputText(JSON.stringify(example, null, 2));
  }, [contract, inputTouched]);

  const parsed = parseWorkflowRunInputJson(inputText);
  const syntax = describeAgentRunInputSyntax(parsed, contract);

  const runQuery = useRunQuery(activeRunId);
  const runStatus = runQuery.data?.status;
  const runLive = runStatus !== undefined && isRunLive(runStatus);

  const attemptPollStatus =
    activeRunId !== undefined &&
    activeAttemptId !== undefined &&
    (runStatus === undefined || runLive)
      ? "PENDING"
      : undefined;
  const attemptQuery = useRunAttemptQuery(
    activeRunId,
    activeAttemptId,
    attemptPollStatus,
  );
  const attemptStatus = attemptQuery.data?.status;
  const attemptLive =
    attemptStatus !== undefined && isAttemptLive(attemptStatus);

  const pollingLive = runLive || attemptLive;
  const deadlineExceeded =
    pollDeadlineMs !== undefined &&
    isPlaygroundRunDeadlineExceeded(pollDeadlineMs) &&
    pollingLive;

  const canSubmit =
    canExecute &&
    agentId.length > 0 &&
    agentVersionId.length > 0 &&
    parsed.ok &&
    !createRun.isPending &&
    !submittingRef.current &&
    !pollingLive;

  const displayName =
    fixedAgentName ?? agentQuery.data?.name ?? fixedAgentKey ?? agentId;

  async function runTest() {
    if (!parsed.ok || submittingRef.current || !canExecute) {
      if (!parsed.ok) {
        setFeedback(parsed.message);
      }
      return;
    }

    submittingRef.current = true;
    setFeedback(undefined);
    setErrorRequestId(undefined);
    setErrorStatus(undefined);
    setActiveRunId(undefined);
    setActiveAttemptId(undefined);
    setPollDeadlineMs(undefined);

    try {
      const created = await createRun.mutateAsync({
        agentId,
        agentVersionId,
        input: parsed.value,
        restrictPersistentMemory,
      });
      setActiveRunId(created.run.id);
      setActiveAttemptId(created.runAttempt.id);
      setPollDeadlineMs(createPlaygroundRunDeadline());
      setFeedback(
        `Run ${created.run.id} was queued. Results appear below when the RunAttempt reaches a terminal status.`,
      );
    } catch (error) {
      setFeedback(
        error instanceof Error ? error.message : "Failed to start test run.",
      );
      if (error instanceof ConsoleApiError) {
        setErrorRequestId(error.body.requestId);
        setErrorStatus(error.status);
      }
    } finally {
      submittingRef.current = false;
    }
  }

  const guidance =
    errorStatus === undefined
      ? undefined
      : describeCreateRunFailure(errorStatus);

  const versions = versionsQuery.data?.versions ?? [];

  return (
    <section className="panel" aria-labelledby="agent-playground-title">
      <h2 className="panel-title" id="agent-playground-title">
        Agent playground
      </h2>
      <p className="muted">
        Executes an ordinary OSVA Run against the selected immutable
        AgentVersion. Tool permissions and external side effects still follow
        the version manifest; blocking persistent memory writes does not make
        tools side-effect free.
      </p>

      {mode === "standalone" ? (
        <div className="filters">
          <div className="field">
            <label htmlFor="playground-agent">Agent</label>
            <select
              id="playground-agent"
              value={selectedAgentId}
              onChange={(event) => {
                setSelectedAgentId(event.target.value);
                setSelectedVersionId("");
                setInputTouched(false);
              }}
              disabled={agentsQuery.isLoading}
            >
              <option value="">Select an agent…</option>
              {(agentsQuery.data?.agents ?? []).map((agent) => (
                <option key={agent.id} value={agent.id}>
                  {agent.name} ({agent.key})
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="playground-version">AgentVersion</label>
            <select
              id="playground-version"
              value={selectedVersionId}
              onChange={(event) => {
                setSelectedVersionId(event.target.value);
                setInputTouched(false);
              }}
              disabled={agentId.length === 0 || versionsQuery.isLoading}
            >
              <option value="">Select a version…</option>
              {versions.map((version) => (
                <option key={version.id} value={version.id}>
                  v{version.version} — {version.id}
                </option>
              ))}
            </select>
          </div>
        </div>
      ) : (
        <dl className="meta-grid">
          <div>
            <dt>Agent</dt>
            <dd>{displayName || "—"}</dd>
          </div>
          <div>
            <dt>AgentVersion</dt>
            <dd className="mono">{agentVersionId || "—"}</dd>
          </div>
        </dl>
      )}

      <div className="field">
        <label>
          <input
            type="checkbox"
            checked={restrictPersistentMemory}
            onChange={(event) => {
              setRestrictPersistentMemory(event.target.checked);
            }}
          />{" "}
          Restrict persistent memory writes (recommended for tests)
        </label>
        <p className="muted">
          When enabled, OSVA persists <code>restrictPersistentMemory</code> on
          the Run and the worker denies durable memory mutation for this
          execution.
        </p>
      </div>

      {contract.status === "loading" ? (
        <LoadingBlock label="Loading input contract…" />
      ) : null}
      {contract.status === "schema_unavailable" ? (
        <EmptyState title="This AgentVersion has no input schema in the manifest." />
      ) : null}
      {contract.status === "version_unavailable" ? (
        <EmptyState title="Select an AgentVersion to configure test input." />
      ) : null}

      {contract.status === "available" ||
      contract.status === "schema_unavailable" ? (
        <>
          <div className="field">
            <label htmlFor="playground-input">Run input (JSON)</label>
            <textarea
              id="playground-input"
              className="code-input"
              rows={10}
              value={inputText}
              onChange={(event) => {
                setInputTouched(true);
                setInputText(event.target.value);
              }}
              spellCheck={false}
            />
            {!parsed.ok ? (
              <p className="error-text" role="alert">
                {parsed.message}
              </p>
            ) : null}
            <p
              className={syntax.kind === "error" ? "error-text" : "muted"}
              role={syntax.kind === "error" ? "alert" : undefined}
            >
              {syntax.message}
            </p>
          </div>

          <div className="toolbar">
            <button
              type="button"
              className="button"
              disabled={!canSubmit}
              onClick={() => void runTest()}
            >
              {createRun.isPending ? "Starting…" : "Run test"}
            </button>
            {!canExecute ? (
              <p className="muted">
                Your workspace role cannot EXECUTE test runs.
              </p>
            ) : null}
          </div>
        </>
      ) : null}

      {feedback !== undefined ? (
        <p className={errorStatus !== undefined ? "error-text" : "muted"}>
          {feedback}
          {guidance !== undefined ? ` ${guidance}` : ""}
          {errorRequestId !== undefined ? (
            <>
              {" "}
              Request ID: <span className="mono">{errorRequestId}</span>
            </>
          ) : null}
        </p>
      ) : null}

      {activeRunId !== undefined ? (
        <section className="panel nested-panel">
          <h3 className="panel-title">Test run</h3>
          {deadlineExceeded ? (
            <p className="error-text" role="alert">
              Polling exceeded the playground deadline. The Run may still be
              executing — open Run detail for the latest state.
            </p>
          ) : null}
          {runQuery.isLoading ? (
            <LoadingBlock label="Loading run status…" />
          ) : null}
          {runQuery.data !== undefined ? (
            <dl className="meta-grid">
              <div>
                <dt>Run status</dt>
                <dd>
                  <StatusChip
                    status={runQuery.data.status}
                    category={runStatusCategory(runQuery.data.status)}
                  />
                </dd>
              </div>
              <div>
                <dt>Run ID</dt>
                <dd className="mono">{runQuery.data.id}</dd>
              </div>
              {runQuery.data.restrictPersistentMemory ? (
                <div>
                  <dt>Memory writes</dt>
                  <dd>Restricted (playground)</dd>
                </div>
              ) : null}
            </dl>
          ) : null}
          {attemptQuery.data !== undefined ? (
            <>
              <dl className="meta-grid">
                <div>
                  <dt>RunAttempt status</dt>
                  <dd>
                    <StatusChip
                      status={attemptQuery.data.status}
                      category={attemptStatusCategory(attemptQuery.data.status)}
                    />
                  </dd>
                </div>
              </dl>
              {attemptQuery.data.error !== undefined ? (
                <JsonView label="Error" value={attemptQuery.data.error} />
              ) : null}
              {attemptQuery.data.output !== undefined ? (
                <JsonView label="Output" value={attemptQuery.data.output} />
              ) : pollingLive ? (
                <LoadingBlock label="Waiting for terminal output…" />
              ) : (
                <EmptyState title="No output recorded." />
              )}
            </>
          ) : null}
          <div className="toolbar">
            <Link className="button" to={`/runs/${activeRunId}`}>
              Open Run detail
            </Link>
          </div>
        </section>
      ) : null}
    </section>
  );
}
