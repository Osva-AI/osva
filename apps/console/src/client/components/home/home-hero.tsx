import { LinkButton } from "../ui/button";

export function HomeHero({
  canWrite,
  canExecute,
}: {
  readonly canWrite: boolean;
  readonly canExecute: boolean;
}) {
  return (
    <section className="home-hero" aria-labelledby="home-hero-title">
      <div className="home-hero-copy">
        <h2 className="home-hero-title" id="home-hero-title">
          What would you like AI to do for you?
        </h2>
        <p className="home-hero-subtitle">
          OSVA helps you build agents and automated workflows that connect
          models, tools, and approvals—then run them with clear lifecycle
          visibility.
        </p>
        <div className="home-hero-actions action-row">
          <LinkButton variant="primary" to="/onboarding">
            Getting started
          </LinkButton>
          {canWrite ? (
            <>
              <LinkButton variant="secondary" to="/agents/new">
                Create agent
              </LinkButton>
              <LinkButton variant="secondary" to="/workflows/new">
                Open complete builder
              </LinkButton>
            </>
          ) : null}
        </div>
      </div>
      <aside
        className="home-hero-aside"
        aria-labelledby="home-hero-aside-title"
      >
        <h3 className="home-hero-aside-title" id="home-hero-aside-title">
          Explore the Console
        </h3>
        <p className="muted home-hero-aside-lead">
          Jump to real routes using your current workspace permissions.
        </p>
        <div className="home-hero-aside-links action-row">
          <LinkButton
            variant="secondary"
            to={canWrite ? "/agents/new" : "/agents"}
          >
            {canWrite ? "Agent Studio" : "View agents"}
          </LinkButton>
          <LinkButton variant="secondary" to="/workflows">
            Workflows
          </LinkButton>
          <LinkButton variant="secondary" to="/models">
            {canWrite ? "Models" : "View models"}
          </LinkButton>
          <LinkButton variant="secondary" to="/runs">
            {canExecute ? "Runs" : "View runs"}
          </LinkButton>
          <LinkButton variant="secondary" to="/testing">
            Testing Studio
          </LinkButton>
        </div>
      </aside>
    </section>
  );
}
