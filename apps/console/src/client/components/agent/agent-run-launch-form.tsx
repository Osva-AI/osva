import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

import { useCreateRunMutation } from "../../hooks/use-runs";
import type { AgentVersionResource } from "../../hooks/use-agents";
import {
  describeAgentRunInputSyntax,
  describeCreateRunFailure,
  resolveAgentVersionInputContract,
} from "../../lib/agent-input-contract";
import { ConsoleApiError } from "../../lib/console-api";
import { trySafeExampleFromJsonSchema } from "../../lib/workflow-root-input-contract";
import { parseWorkflowRunInputJson } from "../../lib/workflow-run-input";
import { JsonView } from "../json-view/json-view";

export interface AgentRunLaunchFormProps {
  readonly agentId: string;
  readonly agentKey?: string;
  readonly agentName?: string;
  readonly selectedVersion: AgentVersionResource;
  readonly canExecute: boolean;
  readonly versionLoading?: boolean;
}

export function AgentRunLaunchForm({
  agentId,
  agentKey,
  agentName,
  selectedVersion,
  canExecute,
  versionLoading = false,
}: AgentRunLaunchFormProps) {
  const navigate = useNavigate();
  const mutation = useCreateRunMutation();
  const submittingRef = useRef(false);
  const contract = resolveAgentVersionInputContract(
    agentId,
    selectedVersion.id,
    selectedVersion,
    { loading: versionLoading },
  );
  const [inputText, setInputText] = useState("{}");
  const [inputTouched, setInputTouched] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [feedback, setFeedback] = useState<string | undefined>();
  const [errorRequestId, setErrorRequestId] = useState<string | undefined>();
  const [errorStatus, setErrorStatus] = useState<number | undefined>();

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
  const canSubmit =
    canExecute && parsed.ok && !mutation.isPending && !submittingRef.current;

  async function startRun() {
    if (!parsed.ok || submittingRef.current) {
      if (!parsed.ok) {
        setFeedback(parsed.message);
      }
      return;
    }

    submittingRef.current = true;
    setFeedback(undefined);
    setErrorRequestId(undefined);
    setErrorStatus(undefined);
    try {
      const created = await mutation.mutateAsync({
        agentId,
        agentVersionId: selectedVersion.id,
        input: parsed.value,
      });
      setFeedback(
        `Run ${created.run.id} was created and queued. Creation is not a terminal SUCCEEDED status.`,
      );
      navigate(`/runs/${created.run.id}`);
    } catch (error) {
      submittingRef.current = false;
      setFeedback(
        error instanceof Error ? error.message : "Failed to start run.",
      );
      if (error instanceof ConsoleApiError) {
        setErrorRequestId(error.body.requestId);
        setErrorStatus(error.status);
      }
    }
  }

  const guidance =
    errorStatus === undefined
      ? undefined
      : describeCreateRunFailure(errorStatus);

  return (
    <section className="panel" aria-labelledby="agent-run-launch-title">
      <h2 className="panel-title" id="agent-run-launch-title">
        Run Agent
      </h2>
      <p className="muted">
        Starts an individual Run from this immutable AgentVersion. This is not a
        WorkflowRun. HTTP success queues execution; inspect the returned Run and
        its RunAttempts for the actual outcome.
      </p>
      <dl className="meta-grid">
        <div>
          <dt>Agent</dt>
          <dd>
            {agentName ?? agentKey ?? <span className="mono">{agentId}</span>}
          </dd>
        </div>
        <div>
          <dt>Agent ID</dt>
          <dd className="mono">{agentId}</dd>
        </div>
        <div>
          <dt>AgentVersion</dt>
          <dd>
            v{selectedVersion.version}{" "}
            <span className="mono">({selectedVersion.id})</span>
          </dd>
        </div>
      </dl>

      <AgentInputContractPanel contract={contract} />

      {!canExecute ? (
        <p className="muted">
          Starting a run requires an OPERATOR, EDITOR, or ADMIN role.
        </p>
      ) : null}

      <div className="field">
        <label htmlFor="agent-run-input-json">Run input (JSON)</label>
        <textarea
          id="agent-run-input-json"
          rows={8}
          value={inputText}
          onChange={(event) => {
            setInputText(event.target.value);
            setInputTouched(true);
            setConfirming(false);
            setFeedback(undefined);
            setErrorStatus(undefined);
            setErrorRequestId(undefined);
          }}
          spellCheck={false}
          disabled={!canExecute || mutation.isPending}
        />
      </div>
      <p
        className={syntax.kind === "error" ? "error-inline" : "muted"}
        role={syntax.kind === "error" ? "alert" : undefined}
      >
        {syntax.message}
      </p>

      {confirming ? (
        <div className="operator-actions">
          <p>
            Start a Run for AgentVersion{" "}
            <span className="mono">{selectedVersion.id}</span> with the JSON
            input above?
          </p>
          <div className="toolbar">
            <button
              type="button"
              className="button primary"
              onClick={() => void startRun()}
              disabled={!canSubmit}
            >
              {mutation.isPending ? "Starting run…" : "Confirm start run"}
            </button>
            <button
              type="button"
              className="button"
              onClick={() => setConfirming(false)}
              disabled={mutation.isPending}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          className="button primary"
          onClick={() => setConfirming(true)}
          disabled={!canSubmit}
        >
          Run Agent
        </button>
      )}

      {mutation.isPending ? (
        <p className="muted" role="status">
          Creating Run…
        </p>
      ) : null}
      {guidance !== undefined ? (
        <p className="error-inline">{guidance}</p>
      ) : null}
      {feedback !== undefined ? (
        <p className={errorRequestId !== undefined ? "error-inline" : "muted"}>
          {feedback}
        </p>
      ) : null}
      {errorRequestId !== undefined ? (
        <p className="muted">
          Request ID: <span className="mono">{errorRequestId}</span>
        </p>
      ) : null}
    </section>
  );
}

function AgentInputContractPanel({
  contract,
}: {
  readonly contract: ReturnType<typeof resolveAgentVersionInputContract>;
}) {
  return (
    <div className="stack" aria-labelledby="agent-run-input-contract-title">
      <h3 className="panel-title" id="agent-run-input-contract-title">
        Input contract
      </h3>
      {contract.status === "available" ? (
        <>
          <p className="muted">
            Selected AgentVersion{" "}
            <span className="mono">{contract.agentVersionId}</span>. The Console
            checks JSON syntax only. The agent runtime validates this payload at
            execution time.
          </p>
          <JsonView label="Input schema" value={contract.schema} />
        </>
      ) : null}
      {contract.status === "schema_unavailable" ? (
        <p className="muted">
          AgentVersion <span className="mono">{contract.agentVersionId}</span>{" "}
          has no input schema on the returned manifest. Valid JSON may still be
          rejected at execution.
        </p>
      ) : null}
      {contract.status === "version_unavailable" ? (
        <p className="muted">
          AgentVersion <span className="mono">{contract.agentVersionId}</span>{" "}
          could not be loaded.
        </p>
      ) : null}
      {contract.status === "loading" ? (
        <p className="muted">Loading the AgentVersion input contract…</p>
      ) : null}
    </div>
  );
}
