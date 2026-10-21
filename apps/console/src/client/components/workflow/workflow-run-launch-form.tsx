import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import { useCreateWorkflowRunMutation } from "../../hooks/use-workflow-runs";
import { useRootAgentInputContract } from "../../hooks/use-root-agent-input-contract";
import { ConsoleApiError } from "../../lib/console-api";
import type { WorkflowDefinitionView } from "../../lib/workflow-definition";
import { trySafeExampleFromJsonSchema } from "../../lib/workflow-root-input-contract";
import {
  describeWorkflowRunInputSyntax,
  parseWorkflowRunInputJson,
} from "../../lib/workflow-run-input";
import {
  buildJsonFromGuidedValues,
  listGuidedRunInputFields,
} from "../../lib/workflow-run-input-guided";
import { JsonView } from "../json-view/json-view";

export interface WorkflowRunLaunchFormProps {
  readonly workflowId: string;
  readonly workflowKey?: string;
  readonly workflowName?: string;
  readonly workflowVersionId: string;
  readonly versionNumber: number;
  readonly canExecute: boolean;
  readonly definition?: WorkflowDefinitionView;
}

export function WorkflowRunLaunchForm({
  workflowId,
  workflowKey,
  workflowName,
  workflowVersionId,
  versionNumber,
  canExecute,
  definition,
}: WorkflowRunLaunchFormProps) {
  const navigate = useNavigate();
  const mutation = useCreateWorkflowRunMutation();
  const contract = useRootAgentInputContract(definition);
  const [inputText, setInputText] = useState("{}");
  const [inputTouched, setInputTouched] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [feedback, setFeedback] = useState<string | undefined>();
  const [errorRequestId, setErrorRequestId] = useState<string | undefined>();
  const [guidedValues, setGuidedValues] = useState<Record<string, string>>({});
  const [useAdvancedJson, setUseAdvancedJson] = useState(false);

  const guidedFields =
    contract.status === "available"
      ? listGuidedRunInputFields(contract.schema)
      : undefined;
  const guidedSupported =
    guidedFields !== undefined && guidedFields.length > 0 && !useAdvancedJson;

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

  const guidedBuilt =
    guidedSupported && guidedFields !== undefined
      ? buildJsonFromGuidedValues(guidedFields, guidedValues)
      : undefined;
  const parsed = guidedSupported
    ? guidedBuilt?.ok === true
      ? { ok: true as const, value: guidedBuilt.value }
      : {
          ok: false as const,
          message: guidedBuilt?.message ?? "Invalid input.",
        }
    : parseWorkflowRunInputJson(inputText);
  const syntax = describeWorkflowRunInputSyntax(parsed, contract);
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

      <RootAgentInputContractPanel contract={contract} />

      {!canExecute ? (
        <p className="muted">
          Starting a run requires an OPERATOR, EDITOR, or ADMIN role.
        </p>
      ) : null}

      {guidedFields !== undefined ? (
        <div className="toolbar">
          <button
            type="button"
            className={`button${guidedSupported ? " primary" : ""}`}
            disabled={!canExecute}
            onClick={() => setUseAdvancedJson(false)}
          >
            Guided form
          </button>
          <button
            type="button"
            className={`button${useAdvancedJson ? " primary" : ""}`}
            disabled={!canExecute}
            onClick={() => setUseAdvancedJson(true)}
          >
            Advanced JSON
          </button>
        </div>
      ) : null}

      {guidedSupported && guidedFields !== undefined ? (
        <div className="stack">
          {guidedFields.map((field) => (
            <div className="field" key={field.key}>
              <label htmlFor={`guided-${field.key}`}>
                {field.label}
                {field.required ? " *" : ""}
              </label>
              {field.kind === "boolean" ? (
                <select
                  id={`guided-${field.key}`}
                  value={guidedValues[field.key] ?? ""}
                  disabled={!canExecute}
                  onChange={(event) =>
                    setGuidedValues((current) => ({
                      ...current,
                      [field.key]: event.target.value,
                    }))
                  }
                >
                  <option value="">Select…</option>
                  <option value="true">Yes</option>
                  <option value="false">No</option>
                </select>
              ) : (
                <input
                  id={`guided-${field.key}`}
                  type={field.kind === "number" ? "number" : "text"}
                  value={guidedValues[field.key] ?? ""}
                  disabled={!canExecute}
                  onChange={(event) =>
                    setGuidedValues((current) => ({
                      ...current,
                      [field.key]: event.target.value,
                    }))
                  }
                />
              )}
            </div>
          ))}
        </div>
      ) : null}

      {!guidedSupported ? (
        <div className="field">
          <label htmlFor="workflow-run-input-json">Run input (JSON)</label>
          <textarea
            id="workflow-run-input-json"
            rows={8}
            value={inputText}
            onChange={(event) => {
              setInputText(event.target.value);
              setInputTouched(true);
              setConfirming(false);
              setFeedback(undefined);
            }}
            spellCheck={false}
            disabled={!canExecute || mutation.isPending}
          />
        </div>
      ) : null}
      <p
        className={syntax.kind === "error" ? "error-inline" : "muted"}
        role={syntax.kind === "error" ? "alert" : undefined}
      >
        {syntax.message}
      </p>

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

function RootAgentInputContractPanel({
  contract,
}: {
  readonly contract: ReturnType<typeof useRootAgentInputContract>;
}) {
  return (
    <div className="stack" aria-labelledby="workflow-run-input-contract-title">
      <h3 className="panel-title" id="workflow-run-input-contract-title">
        First-agent input contract
      </h3>
      <RootAgentInputContractBody contract={contract} />
    </div>
  );
}

function RootAgentInputContractBody({
  contract,
}: {
  readonly contract: ReturnType<typeof useRootAgentInputContract>;
}) {
  switch (contract.status) {
    case "available":
      return (
        <>
          <p className="muted">
            The first agent step (
            <span className="mono">{contract.nodeKey}</span>) defines the input
            expected when the workflow starts. The agent validates this payload
            at execution time.
          </p>
          <JsonView label="Input schema" value={contract.schema} />
        </>
      );
    case "schema_unavailable":
      return (
        <p className="muted">
          Root AGENT node <span className="mono">{contract.nodeKey}</span> binds
          AgentVersion <span className="mono">{contract.agentVersionId}</span>,
          but its input schema is unavailable. Valid JSON may still be rejected
          at execution.
        </p>
      );
    case "catalog_unavailable":
      return (
        <p className="muted">
          Agent version metadata could not be loaded. Valid JSON may still be
          rejected at execution.
        </p>
      );
    case "non_agent_root":
      return (
        <p className="muted">
          Root node <span className="mono">{contract.nodeKey}</span> is{" "}
          <span className="mono">{contract.nodeType}</span>. No agent input
          contract is shown for non-AGENT roots.
        </p>
      );
    case "multiple_roots":
      return (
        <p className="muted">
          Multiple root nodes (
          {contract.nodeKeys.map((key) => (
            <span key={key} className="mono">
              {key}{" "}
            </span>
          ))}
          ). V3 requires a single entry node, so no single agent input contract
          is shown.
        </p>
      );
    case "missing_binding":
      return (
        <p className="muted">
          Root AGENT node <span className="mono">{contract.nodeKey}</span> has
          no bound AgentVersion.
        </p>
      );
    case "loading":
      return <p className="muted">Loading the first agent's input contract…</p>;
    case "no_root":
      return (
        <p className="muted">
          This definition has no root node, so no agent input contract is shown.
        </p>
      );
    default:
      return (
        <p className="muted">
          No published root-agent input contract is available for this version.
        </p>
      );
  }
}
