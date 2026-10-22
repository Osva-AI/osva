import { useEffect, useState, type MouseEvent } from "react";
import { Link } from "react-router-dom";

import { usePublishEvaluationSuiteVersionMutation } from "../../hooks/use-evaluations";
import { useAuthContextQuery } from "../../hooks/use-auth-context";
import {
  createEmptyCaseDraft,
  duplicateCaseDraft,
  markDraftDirty,
  type EvaluationSuiteCaseDraft,
  type EvaluationSuiteVersionDraft,
} from "../../lib/evaluation-suite-builder-draft";
import {
  fieldErrorsForCase,
  validateDraftForPublish,
  type EvaluationSuiteFieldError,
} from "../../lib/evaluation-suite-builder-validation";
import { ConsoleApiError } from "../../lib/console-api";
import { roleCanWriteControlPlaneResources } from "../../lib/permissions";
import { ErrorState } from "../error-state/error-state";
import { LoadingBlock } from "../loading/loading-block";

export interface EvaluationSuiteBuilderWorkspaceProps {
  readonly title: string;
  readonly subtitle: string;
  readonly initialDraft: EvaluationSuiteVersionDraft | undefined;
  readonly backLink: { readonly to: string; readonly label: string };
  readonly onPublished: (input: {
    readonly evaluationSuiteId: string;
    readonly evaluationSuiteVersionId: string;
  }) => void;
}

export function EvaluationSuiteBuilderWorkspace({
  title,
  subtitle,
  initialDraft,
  backLink,
  onPublished,
}: EvaluationSuiteBuilderWorkspaceProps) {
  const authQuery = useAuthContextQuery();
  const publishMutation = usePublishEvaluationSuiteVersionMutation();
  const [draft, setDraft] = useState<EvaluationSuiteVersionDraft | undefined>(
    initialDraft,
  );
  const [fieldErrors, setFieldErrors] = useState<
    readonly EvaluationSuiteFieldError[]
  >([]);
  const [feedback, setFeedback] = useState<string | undefined>();
  const [errorRequestId, setErrorRequestId] = useState<string | undefined>();

  useEffect(() => {
    if (initialDraft !== undefined) {
      setDraft(initialDraft);
      setFieldErrors([]);
      setFeedback(undefined);
    }
  }, [initialDraft?.draftId]);

  useEffect(() => {
    if (draft === undefined || !draft.dirty) {
      return;
    }
    const handler = (event: BeforeUnloadEvent): void => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", handler);
    return () => {
      window.removeEventListener("beforeunload", handler);
    };
  }, [draft?.dirty]);

  const canWrite =
    authQuery.data !== undefined &&
    roleCanWriteControlPlaneResources(authQuery.data.role);

  if (authQuery.isLoading || draft === undefined) {
    return <LoadingBlock label="Loading test suite editor…" />;
  }

  if (authQuery.isError) {
    return <ErrorState title="Authentication failed" error={authQuery.error} />;
  }

  function updateDraft(
    updater: (
      current: EvaluationSuiteVersionDraft,
    ) => EvaluationSuiteVersionDraft,
  ) {
    setDraft((current) => {
      if (current === undefined) {
        return current;
      }
      return markDraftDirty(updater(current));
    });
    setFieldErrors([]);
    setFeedback(undefined);
  }

  function updateCase(
    draftCaseId: string,
    patch: Partial<EvaluationSuiteCaseDraft>,
  ) {
    updateDraft((current) => ({
      ...current,
      cases: current.cases.map((evaluationCase) =>
        evaluationCase.draftCaseId === draftCaseId
          ? { ...evaluationCase, ...patch }
          : evaluationCase,
      ),
    }));
  }

  function removeCase(draftCaseId: string) {
    updateDraft((current) => ({
      ...current,
      cases: current.cases.filter(
        (evaluationCase) => evaluationCase.draftCaseId !== draftCaseId,
      ),
    }));
  }

  function moveCase(draftCaseId: string, direction: -1 | 1) {
    updateDraft((current) => {
      const index = current.cases.findIndex(
        (evaluationCase) => evaluationCase.draftCaseId === draftCaseId,
      );
      if (index < 0) {
        return current;
      }
      const target = index + direction;
      if (target < 0 || target >= current.cases.length) {
        return current;
      }
      const next = [...current.cases];
      const [removed] = next.splice(index, 1);
      next.splice(target, 0, removed!);
      return { ...current, cases: next };
    });
  }

  function handleBackClick(event: MouseEvent<HTMLAnchorElement>) {
    if (draft?.dirty) {
      const confirmed = window.confirm(
        "Discard unsaved changes to this draft?",
      );
      if (!confirmed) {
        event.preventDefault();
      }
    }
  }

  async function publish() {
    if (draft === undefined || !canWrite) {
      return;
    }
    setFeedback(undefined);
    setErrorRequestId(undefined);

    const validation = validateDraftForPublish(draft);
    if (!validation.ok) {
      setFieldErrors(validation.fieldErrors);
      setFeedback("Fix validation errors before publishing.");
      return;
    }

    try {
      const version = await publishMutation.mutateAsync({
        evaluationSuiteId: draft.evaluationSuiteId,
        cases: validation.cases,
      });
      setDraft({ ...draft, dirty: false });
      onPublished({
        evaluationSuiteId: draft.evaluationSuiteId,
        evaluationSuiteVersionId: version.id,
      });
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Publish failed.");
      if (error instanceof ConsoleApiError) {
        setErrorRequestId(error.body.requestId);
      }
    }
  }

  return (
    <>
      <header className="page-header">
        <div>
          <h1 className="page-title">{title}</h1>
          <p className="page-subtitle">{subtitle}</p>
        </div>
        <div className="toolbar">
          {canWrite ? (
            <button
              type="button"
              className="button primary"
              disabled={publishMutation.isPending}
              onClick={() => void publish()}
            >
              Publish version
            </button>
          ) : null}
          <Link className="button" to={backLink.to} onClick={handleBackClick}>
            {backLink.label}
          </Link>
        </div>
      </header>

      {!canWrite ? (
        <p className="muted">
          Publishing test suite versions requires an EDITOR or ADMIN role.
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

      <section className="panel">
        <div className="toolbar">
          <h2 className="panel-title">Test cases</h2>
          {canWrite ? (
            <button
              type="button"
              className="button button-secondary"
              onClick={() =>
                updateDraft((current) => ({
                  ...current,
                  cases: [...current.cases, createEmptyCaseDraft()],
                }))
              }
            >
              Add case
            </button>
          ) : null}
        </div>

        {draft.cases.length === 0 ? (
          <p className="muted">Add at least one test case to publish.</p>
        ) : null}

        <div className="stack" style={{ gap: 16 }}>
          {draft.cases.map((evaluationCase, index) => (
            <article
              key={evaluationCase.draftCaseId}
              className="panel nested-panel"
              aria-label={`Test case ${index + 1}`}
            >
              <div className="toolbar">
                <h3 className="panel-title">Case {index + 1}</h3>
                {canWrite ? (
                  <div
                    className="stack"
                    style={{ flexDirection: "row", gap: 8 }}
                  >
                    <button
                      type="button"
                      className="button button-secondary"
                      disabled={index === 0}
                      onClick={() => moveCase(evaluationCase.draftCaseId, -1)}
                    >
                      Move up
                    </button>
                    <button
                      type="button"
                      className="button button-secondary"
                      disabled={index === draft.cases.length - 1}
                      onClick={() => moveCase(evaluationCase.draftCaseId, 1)}
                    >
                      Move down
                    </button>
                    <button
                      type="button"
                      className="button button-secondary"
                      onClick={() =>
                        updateDraft((current) => ({
                          ...current,
                          cases: [
                            ...current.cases,
                            duplicateCaseDraft(evaluationCase),
                          ],
                        }))
                      }
                    >
                      Duplicate
                    </button>
                    <button
                      type="button"
                      className="button button-secondary"
                      disabled={draft.cases.length <= 1}
                      onClick={() => removeCase(evaluationCase.draftCaseId)}
                    >
                      Remove
                    </button>
                  </div>
                ) : null}
              </div>

              <div className="filters">
                <div className="field">
                  <label htmlFor={`case-key-${evaluationCase.draftCaseId}`}>
                    Case key
                  </label>
                  <input
                    id={`case-key-${evaluationCase.draftCaseId}`}
                    className="mono"
                    value={evaluationCase.key}
                    disabled={!canWrite}
                    onChange={(event) =>
                      updateCase(evaluationCase.draftCaseId, {
                        key: event.target.value,
                      })
                    }
                  />
                  {fieldErrorsForCase(
                    fieldErrors,
                    evaluationCase.draftCaseId,
                    "key",
                  ).map((message) => (
                    <p key={message} className="field-error" role="alert">
                      {message}
                    </p>
                  ))}
                </div>
                <div className="field">
                  <label htmlFor={`case-name-${evaluationCase.draftCaseId}`}>
                    Display name (optional)
                  </label>
                  <input
                    id={`case-name-${evaluationCase.draftCaseId}`}
                    value={evaluationCase.name}
                    disabled={!canWrite}
                    onChange={(event) =>
                      updateCase(evaluationCase.draftCaseId, {
                        name: event.target.value,
                      })
                    }
                  />
                </div>
              </div>

              <div className="filters">
                <div className="field">
                  <label htmlFor={`case-input-${evaluationCase.draftCaseId}`}>
                    Test input
                  </label>
                  <textarea
                    id={`case-input-${evaluationCase.draftCaseId}`}
                    className="mono"
                    rows={6}
                    spellCheck={false}
                    disabled={!canWrite}
                    value={evaluationCase.inputJson}
                    onChange={(event) =>
                      updateCase(evaluationCase.draftCaseId, {
                        inputJson: event.target.value,
                      })
                    }
                  />
                  {fieldErrorsForCase(
                    fieldErrors,
                    evaluationCase.draftCaseId,
                    "inputJson",
                  ).map((message) => (
                    <p key={message} className="field-error" role="alert">
                      {message}
                    </p>
                  ))}
                </div>
                <div className="field">
                  <label
                    htmlFor={`case-expected-${evaluationCase.draftCaseId}`}
                  >
                    Expected output
                  </label>
                  <textarea
                    id={`case-expected-${evaluationCase.draftCaseId}`}
                    className="mono"
                    rows={6}
                    spellCheck={false}
                    disabled={!canWrite}
                    value={evaluationCase.expectedOutputJson}
                    onChange={(event) =>
                      updateCase(evaluationCase.draftCaseId, {
                        expectedOutputJson: event.target.value,
                      })
                    }
                  />
                  {fieldErrorsForCase(
                    fieldErrors,
                    evaluationCase.draftCaseId,
                    "expectedOutputJson",
                  ).map((message) => (
                    <p key={message} className="field-error" role="alert">
                      {message}
                    </p>
                  ))}
                </div>
              </div>
              <p className="muted">
                Evaluator: JSON exact match (compares run output to expected
                output).
              </p>
            </article>
          ))}
        </div>
      </section>
    </>
  );
}
