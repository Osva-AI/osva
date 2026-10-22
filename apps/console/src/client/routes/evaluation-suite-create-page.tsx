import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";

import { useAuthContextQuery } from "../hooks/use-auth-context";
import { useCreateEvaluationSuiteMutation } from "../hooks/use-evaluations";
import { ConsoleApiError } from "../lib/console-api";
import { roleCanWriteControlPlaneResources } from "../lib/permissions";

export function EvaluationSuiteCreatePage() {
  const navigate = useNavigate();
  const authQuery = useAuthContextQuery();
  const createSuite = useCreateEvaluationSuiteMutation();
  const [key, setKey] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [feedback, setFeedback] = useState<string | undefined>();
  const [errorRequestId, setErrorRequestId] = useState<string | undefined>();

  const canWrite =
    authQuery.data !== undefined &&
    roleCanWriteControlPlaneResources(authQuery.data.role);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!canWrite) {
      return;
    }
    setFeedback(undefined);
    setErrorRequestId(undefined);

    const trimmedKey = key.trim();
    const trimmedName = name.trim();
    if (trimmedKey.length === 0 || trimmedName.length === 0) {
      setFeedback("Suite key and name are required.");
      return;
    }

    try {
      const suite = await createSuite.mutateAsync({
        key: trimmedKey,
        name: trimmedName,
        ...(description.trim().length > 0
          ? { description: description.trim() }
          : {}),
      });
      navigate(`/testing/suites/${suite.id}/versions/new`, { replace: true });
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Create failed.");
      if (error instanceof ConsoleApiError) {
        setErrorRequestId(error.body.requestId);
      }
    }
  }

  return (
    <>
      <header className="page-header">
        <div>
          <h1 className="page-title">Create evaluation suite</h1>
          <p className="page-subtitle">
            Register a suite, then publish immutable versions with JSON test
            cases.
          </p>
        </div>
        <Link className="button" to="/testing">
          Back to Testing Studio
        </Link>
      </header>

      {!canWrite ? (
        <p className="muted">
          Creating evaluation suites requires an EDITOR or ADMIN role.
        </p>
      ) : null}

      {feedback !== undefined ? (
        <p className="form-feedback error" role="alert">
          {feedback}
          {errorRequestId !== undefined ? (
            <span className="mono"> Request ID: {errorRequestId}</span>
          ) : null}
        </p>
      ) : null}

      <form className="panel" onSubmit={(event) => void submit(event)}>
        <div className="filters">
          <div className="field">
            <label htmlFor="suite-key">Suite key</label>
            <input
              id="suite-key"
              className="mono"
              value={key}
              disabled={!canWrite || createSuite.isPending}
              onChange={(event) => {
                setKey(event.target.value);
                setFeedback(undefined);
              }}
              autoComplete="off"
            />
          </div>
          <div className="field">
            <label htmlFor="suite-name">Suite name</label>
            <input
              id="suite-name"
              value={name}
              disabled={!canWrite || createSuite.isPending}
              onChange={(event) => {
                setName(event.target.value);
                setFeedback(undefined);
              }}
              autoComplete="off"
            />
          </div>
          <div className="field">
            <label htmlFor="suite-description">Description (optional)</label>
            <textarea
              id="suite-description"
              rows={3}
              disabled={!canWrite || createSuite.isPending}
              value={description}
              onChange={(event) => {
                setDescription(event.target.value);
                setFeedback(undefined);
              }}
            />
          </div>
        </div>
        <div className="toolbar">
          <button
            type="submit"
            className="button primary"
            disabled={!canWrite || createSuite.isPending}
          >
            Create suite
          </button>
        </div>
      </form>
    </>
  );
}
