import { useEffect, useRef, useState } from "react";

import type { UseRunLiveStreamResult } from "../../hooks/use-run-live-stream.js";

export interface RunLiveOutputPanelProps {
  readonly live: UseRunLiveStreamResult;
  readonly runStatus: string;
  readonly attemptStatus: string | undefined;
  readonly modelStepStatus: string | undefined;
}

export function RunLiveOutputPanel({
  live,
  runStatus,
  attemptStatus,
  modelStepStatus,
}: RunLiveOutputPanelProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [stickToBottom, setStickToBottom] = useState(true);

  useEffect(() => {
    if (!stickToBottom || scrollRef.current === null) {
      return;
    }
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [live.partialText, stickToBottom]);

  const showPanel =
    live.phase !== "IDLE" ||
    runStatus === "RUNNING" ||
    runStatus === "QUEUED" ||
    runStatus === "PENDING";

  if (!showPanel) {
    return null;
  }

  const titleId = "run-live-output-title";
  const statusId = "run-live-output-status";

  return (
    <section
      className="panel run-live-output"
      aria-labelledby={titleId}
      data-testid="run-live-output"
    >
      <div className="run-live-output-head">
        <h2 id={titleId} className="panel-title">
          Live output
        </h2>
        <p id={statusId} className="run-live-output-status muted" role="status">
          {live.statusAnnouncement}
        </p>
      </div>

      {live.historyGap ? (
        <p className="run-live-output-gap muted" role="note">
          Some live output may be missing. This view does not replay past
          events.
        </p>
      ) : null}

      {live.phase === "CONNECTING" ? (
        <p className="muted" data-testid="run-live-connecting">
          Connecting to live output…
        </p>
      ) : null}

      {live.phase === "UNAVAILABLE" ? (
        <p className="muted" data-testid="run-live-unavailable">
          Live output is not enabled on this deployment.
        </p>
      ) : null}

      {live.statusOnly && !live.textVisible && live.phase === "LIVE" ? (
        <p className="muted" data-testid="run-live-status-only">
          Agent is running. Live text is not enabled for this deployment
          (status-only mode).
        </p>
      ) : null}

      {live.textVisible && live.partialText.length > 0 ? (
        <>
          <p className="visually-hidden" role="note">
            Partial live model output. Persisted run results below are
            authoritative when the run completes.
          </p>
          <div
            ref={scrollRef}
            className="run-live-output-text"
            data-testid="run-live-text"
            onScroll={(event) => {
              const element = event.currentTarget;
              const nearBottom =
                element.scrollHeight -
                  element.scrollTop -
                  element.clientHeight <
                48;
              setStickToBottom(nearBottom);
            }}
          >
            <pre className="run-live-output-pre">{live.partialText}</pre>
          </div>
          <p className="muted run-live-output-partial-label">
            Partial live output (not the final persisted result).
          </p>
        </>
      ) : null}

      {(live.phase === "DISCONNECTED" || live.phase === "ERROR") &&
      live.partialText.length > 0 ? (
        <p className="muted" role="status">
          Live connection interrupted. Partial text above may be incomplete.
        </p>
      ) : null}

      <dl className="meta-grid run-live-output-meta">
        <div>
          <dt>Run status</dt>
          <dd>{runStatus}</dd>
        </div>
        {attemptStatus !== undefined ? (
          <div>
            <dt>Attempt status</dt>
            <dd>{attemptStatus}</dd>
          </div>
        ) : null}
        {modelStepStatus !== undefined ? (
          <div>
            <dt>Latest MODEL step</dt>
            <dd>{modelStepStatus}</dd>
          </div>
        ) : null}
      </dl>
    </section>
  );
}
