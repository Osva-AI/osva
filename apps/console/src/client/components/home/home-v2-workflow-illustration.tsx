/** Decorative workflow motif — not derived from live workflow graph data. */
export function HomeV2WorkflowIllustration() {
  return (
    <div
      className="home-v2-workflow-illustration"
      aria-hidden="true"
      data-testid="home-v2-workflow-illustration"
    >
      <div className="home-v2-illus-card">
        <div className="home-v2-illus-row">
          <span className="home-v2-illus-chip" />
          <span className="home-v2-illus-bar" />
        </div>
        <div className="home-v2-illus-row">
          <span className="home-v2-illus-chip home-v2-illus-chip-accent" />
          <span className="home-v2-illus-bar home-v2-illus-bar-short" />
        </div>
        <div className="home-v2-illus-connectors">
          <span />
          <span />
          <span />
        </div>
      </div>
    </div>
  );
}
