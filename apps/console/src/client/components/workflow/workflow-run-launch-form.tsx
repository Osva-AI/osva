import { useState } from "react";
import { useNavigate } from "react-router-dom";

import { useCreateWorkflowRunMutation } from "../../hooks/use-workflow-runs";
import { ConsoleApiError } from "../../lib/console-api";
import { parseWorkflowRunInputJson } from "../../lib/workflow-run-input";

export interface WorkflowRunLaunchFormProps {
  readonly workflowId: string;
  readonly workflowKey?: string;
  readonly workflowName?: string;
  readonly workflowVersionId: string;
  readonly versionNumber: number;
  readonly canExecute: boolean;
}

export function WorkflowRunLaunchForm({
  workflowId,
  workflowKey,
  workflowName,
  workflowVersionId,
  versionNumber,
  canExecute,
}: WorkflowRunLaunchFormProps) {
  const navigate = useNavigate();
  const mutation = useCreateWorkflowRunMutation();
  const [inputText, setInputText] = useState("{}");
  const [confirming, setConfirming] = useState(false);
  const [feedback, setFeedback] = useState<string | undefined>();
  const [errorRequestId, setErrorRequestId] = useState<string | undefined>();

  const parsed = parseWorkflowRunInputJson(inputText);
  const canSubmit = canExecute && parsed.ok && !mutation.isPending;

  async function startRun() {
    if (!parsed.ok) {
      setFeedback(parsed.message);
      return;
    }

    setFeedback(undefined);
    setErrorRequestId(undefined);
    try {
      const created = await mutation.mutateAsync({
        workflowVersionId,
        input: parsed.value,
      });
      setFeedback(`Created WorkflowRun ${created.id}.`);
      navigate(`/workflow-runs/${created.id}`);
    } catch (error) {
      setFeedback(
        error instanceof Error
          ? error.message
          : "Failed to start workflow run.",
      );
      if (error instanceof ConsoleApiError) {
        setErrorRequestId(error.body.requestId);
      }
    }
  }

  return (
    <section className="panel" aria-labelledby="workflow-run-launch-title">
      <h2 className="panel-title" id="workflow-run-launch-title">
        Run workflow
      </h2>
      <p className="muted">
        Starts a WorkflowRun from this immutable published WorkflowVersion.
        Draft definitions cannot be executed.
      </p>
      <dl className="meta-grid">
        <div>
          <dt>Workflow</dt>
          <dd>
            {workflowName ?? workflowKey ?? (
              <span className="mono">{workflowId}</span>
            )}
          </dd>
        </div>
        <div>
          <dt>Workflow ID</dt>
          <dd className="mono">{workflowId}</dd>
        </div>
        <div>
          <dt>Version</dt>
          <dd>
            {versionNumber} <span className="mono">({workflowVersionId})</span>
          </dd>
        </div>
      </dl>

      {!canExecute ? (
        <p className="muted">
          Starting a run requires an OPERATOR, EDITOR, or ADMIN role.
        </p>
      ) : null}

      <div className="field">
        <label htmlFor="workflow-run-input-json">Run input (JSON)</label>
        <textarea
          id="workflow-run-input-json"
          rows={8}
          value={inputText}
          onChange={(event) => {
            setInputText(event.target.value);
            setConfirming(false);
            setFeedback(undefined);
          }}
          spellCheck={false}
          disabled={!canExecute || mutation.isPending}
        />
      </div>
      {!parsed.ok ? (
        <p className="error-inline" role="alert">
          {parsed.message}
        </p>
      ) : (
        <p className="muted">JSON syntax is valid.</p>
      )}

      {confirming ? (
        <div className="operator-actions">
          <p>
            Start a WorkflowRun for version{" "}
            <span className="mono">{workflowVersionId}</span> with the JSON
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
          Start run
        </button>
      )}

      {mutation.isPending ? (
        <p className="muted" role="status">
          Starting WorkflowRun…
        </p>
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
