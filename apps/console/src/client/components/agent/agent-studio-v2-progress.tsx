import {
  AGENT_STUDIO_V2_STAGES,
  describeStageIndex,
  type AgentStudioV2StageId,
} from "../../lib/agent-studio-v2-stages";

export function AgentStudioV2Progress(props: {
  readonly current: AgentStudioV2StageId;
  readonly maxReachable: AgentStudioV2StageId;
  readonly onNavigate?: (stage: AgentStudioV2StageId) => void;
}) {
  const currentIndex = describeStageIndex(props.current);
  const maxIndex = describeStageIndex(props.maxReachable);

  return (
    <>
      <nav
        className="agent-studio-v2-progress agent-studio-v2-progress-desktop"
        aria-label="Agent Studio progress"
        data-testid="agent-studio-v2-progress"
      >
        <ol className="agent-studio-v2-progress-list">
          {AGENT_STUDIO_V2_STAGES.map((stage, index) => {
            const complete = index < currentIndex;
            const viewing = index === currentIndex;
            const reachable = index <= maxIndex;
            const itemClass = [
              "agent-studio-v2-progress-item",
              complete ? "is-complete" : "",
              viewing ? "is-viewing" : "",
              !reachable ? "is-upcoming" : "",
            ]
              .filter(Boolean)
              .join(" ");
            return (
              <li key={stage.id} className={itemClass}>
                {props.onNavigate !== undefined && reachable ? (
                  <button
                    type="button"
                    className="agent-studio-v2-progress-link"
                    aria-current={viewing ? "step" : undefined}
                    onClick={() => props.onNavigate?.(stage.id)}
                  >
                    <span className="agent-studio-v2-progress-num">
                      {index + 1}
                    </span>
                    <span className="agent-studio-v2-progress-text">
                      <span className="agent-studio-v2-progress-title">
                        {stage.title}
                      </span>
                    </span>
                  </button>
                ) : (
                  <span className="agent-studio-v2-progress-link">
                    <span className="agent-studio-v2-progress-num">
                      {index + 1}
                    </span>
                    <span className="agent-studio-v2-progress-text">
                      <span className="agent-studio-v2-progress-title">
                        {stage.title}
                      </span>
                    </span>
                  </span>
                )}
              </li>
            );
          })}
        </ol>
      </nav>

      <div
        className="agent-studio-v2-progress-mobile"
        data-testid="agent-studio-v2-progress-mobile"
      >
        <div className="agent-studio-v2-progress-mobile-compact">
          <div className="agent-studio-v2-progress-mobile-row">
            <span className="agent-studio-v2-progress-mobile-step">
              Step {currentIndex + 1} of {AGENT_STUDIO_V2_STAGES.length}
            </span>
            <span className="agent-studio-v2-progress-mobile-status">
              {AGENT_STUDIO_V2_STAGES[currentIndex]?.title}
            </span>
          </div>
          <div
            className="agent-studio-v2-progress-mobile-track"
            aria-hidden="true"
          >
            {AGENT_STUDIO_V2_STAGES.map((stage, index) => {
              const segmentClass = [
                "agent-studio-v2-progress-mobile-segment",
                index < currentIndex ? "is-complete" : "",
                index === currentIndex ? "is-viewing" : "",
              ]
                .filter(Boolean)
                .join(" ");
              return <span key={stage.id} className={segmentClass} />;
            })}
          </div>
        </div>
        <details className="agent-studio-v2-progress-mobile-expand">
          <summary>All steps</summary>
          <ol className="agent-studio-v2-progress-mobile-list">
            {AGENT_STUDIO_V2_STAGES.map((stage, index) => (
              <li key={stage.id}>
                {props.onNavigate !== undefined && index <= maxIndex ? (
                  <button
                    type="button"
                    className="agent-studio-v2-progress-mobile-link"
                    onClick={() => props.onNavigate?.(stage.id)}
                  >
                    {stage.title}
                  </button>
                ) : (
                  <span className="agent-studio-v2-progress-mobile-link">
                    {stage.title}
                  </span>
                )}
              </li>
            ))}
          </ol>
        </details>
      </div>
    </>
  );
}
