import { useMemo, useState } from "react";

import { useIngestWorkflowEventMutation } from "../../hooks/use-workflow-runs";
import { ConsoleApiError } from "../../lib/console-api";
import { resolveJsonPointerValue } from "../../lib/workflow-definition";

interface EventWaitConfig {
  readonly kind: "EVENT";
  readonly source: string;
  readonly eventType: string;
  readonly correlation: {
    readonly kind: "LITERAL" | "INPUT_POINTER";
    readonly value?: string;
    readonly pointer?: string;
  };
  readonly timeoutMs?: number;
}

interface WorkflowEventEmitFormProps {
  readonly wait: EventWaitConfig;
  readonly workflowInput: unknown;
  readonly workflowRunId: string;
  readonly canExecute: boolean;
}

export function WorkflowEventEmitForm({
  wait,
  workflowInput,
  workflowRunId,
  canExecute,
}: WorkflowEventEmitFormProps) {
  const mutation = useIngestWorkflowEventMutation(workflowRunId);
  const initialCorrelation = useMemo(
    () => resolveInitialCorrelation(wait, workflowInput),
    [wait, workflowInput],
  );

  const [source, setSource] = useState(wait.source);
  const [eventType, setEventType] = useState(wait.eventType);
  const [correlationKey, setCorrelationKey] = useState(initialCorrelation);
  const [idempotencyKey, setIdempotencyKey] = useState(createIdempotencyKey);
  const [payloadText, setPayloadText] = useState("{}");
  const [feedback, setFeedback] = useState<string | undefined>();
  const [errorRequestId, setErrorRequestId] = useState<string | undefined>();

  if (!canExecute) {
    return (
      <p className="muted">
        Your API key role cannot emit workflow events (EXECUTE required).
      </p>
    );
  }

  async function submit() {
    setFeedback(undefined);
    setErrorRequestId(undefined);
    let payload: unknown;
    try {
      payload = JSON.parse(payloadText) as unknown;
    } catch {
      setFeedback("Payload must be valid JSON.");
      return;
    }

    if (correlationKey.trim().length === 0) {
      setFeedback("Correlation key is required.");
      return;
    }

    try {
      await mutation.mutateAsync({
        source: source.trim(),
        eventType: eventType.trim(),
        correlationKey: correlationKey.trim(),
        idempotencyKey: idempotencyKey.trim(),
        payload,
      });
      setFeedback(
        "Event submitted. OSVA will resume only if it matches the wait.",
      );
      setIdempotencyKey(createIdempotencyKey());
    } catch (error) {
      setFeedback(
        error instanceof Error ? error.message : "Event submission failed.",
      );
      if (error instanceof ConsoleApiError) {
        setErrorRequestId(error.body.requestId);
      }
    }
  }

  return (
    <section className="operator-actions">
      <h3 className="section-title">Emit event</h3>
      <p className="muted">
        Submitting an event does not force-resume the workflow. OSVA resumes
        only when the event matches this wait configuration.
      </p>
      <div className="stack">
        <div className="field">
          <label htmlFor="event-source">Source</label>
          <input
            id="event-source"
            value={source}
            onChange={(event) => setSource(event.target.value)}
            disabled={mutation.isPending}
          />
        </div>
        <div className="field">
          <label htmlFor="event-type">Event type</label>
          <input
            id="event-type"
            value={eventType}
            onChange={(event) => setEventType(event.target.value)}
            disabled={mutation.isPending}
          />
        </div>
        <div className="field">
          <label htmlFor="event-correlation">Correlation key</label>
          <input
            id="event-correlation"
            value={correlationKey}
            onChange={(event) => setCorrelationKey(event.target.value)}
            disabled={mutation.isPending}
          />
          {wait.correlation.kind === "INPUT_POINTER" ? (
            <p className="muted" style={{ fontSize: 12 }}>
              Derived from input pointer {wait.correlation.pointer}. Verify the
              value matches the running wait before emitting.
            </p>
          ) : null}
        </div>
        <div className="field">
          <label htmlFor="event-idempotency">Idempotency key</label>
          <input
            id="event-idempotency"
            value={idempotencyKey}
            onChange={(event) => setIdempotencyKey(event.target.value)}
            disabled={mutation.isPending}
          />
        </div>
        <div className="field">
          <label htmlFor="event-payload">Payload (JSON)</label>
          <textarea
            id="event-payload"
            rows={4}
            value={payloadText}
            onChange={(event) => setPayloadText(event.target.value)}
            disabled={mutation.isPending}
          />
        </div>
        <button
          type="button"
          className="button primary"
          disabled={mutation.isPending}
          onClick={() => void submit()}
        >
          Emit event
        </button>
      </div>
      {feedback !== undefined ? <p>{feedback}</p> : null}
      {errorRequestId !== undefined ? (
        <p className="mono">Request ID: {errorRequestId}</p>
      ) : null}
    </section>
  );
}

function resolveInitialCorrelation(
  wait: EventWaitConfig,
  workflowInput: unknown,
): string {
  if (wait.correlation.kind === "LITERAL") {
    return wait.correlation.value ?? "";
  }
  if (
    wait.correlation.kind === "INPUT_POINTER" &&
    wait.correlation.pointer !== undefined
  ) {
    const resolved = resolveJsonPointerValue(
      wait.correlation.pointer,
      workflowInput,
    );
    return typeof resolved === "string" ? resolved : "";
  }
  return "";
}

function createIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `event-${String(Date.now())}`;
}
