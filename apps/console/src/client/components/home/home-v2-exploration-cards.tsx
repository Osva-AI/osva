import { Link } from "react-router-dom";

export function HomeV2ExplorationCards() {
  return (
    <>
      <div className="home-v2-section-head home-v2-section-head-block">
        <div>
          <h2 className="home-v2-section-heading">Or choose what to build</h2>
          <p className="home-v2-section-sub muted">
            Start with the kind of work you want to automate.
          </p>
        </div>
      </div>
      <div className="home-v2-choice-grid">
        <Link className="home-v2-choice" to="/agents">
          <span className="home-v2-choice-icon" aria-hidden="true">
            AI
          </span>
          <span className="home-v2-choice-body">
            <strong>An AI agent</strong>
            <p className="muted">
              A helpful assistant for research, customer questions, analysis, or
              any task you describe.
            </p>
            <span className="home-v2-choice-action">Explore agents</span>
          </span>
        </Link>
        <Link className="home-v2-choice home-v2-choice-peach" to="/workflows">
          <span
            className="home-v2-choice-icon home-v2-choice-icon-peach"
            aria-hidden="true"
          >
            Flow
          </span>
          <span className="home-v2-choice-body">
            <strong>An automated workflow</strong>
            <p className="muted">
              Connect agents, decisions, and approvals into a repeatable
              process.
            </p>
            <span className="home-v2-choice-action">Explore workflows</span>
          </span>
        </Link>
      </div>
    </>
  );
}
