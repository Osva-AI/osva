import { LinkButton } from "../ui/button";

export function HomeV2SecondaryActions({
  canWrite,
}: {
  readonly canWrite: boolean;
}) {
  return (
    <section
      className="home-v2-create-row"
      aria-labelledby="home-v2-secondary-title"
    >
      <div className="home-v2-section-head home-v2-section-head-block">
        <div>
          <h2 id="home-v2-secondary-title" className="home-v2-section-heading">
            Create something new
          </h2>
          <p className="home-v2-section-sub muted">
            Start a new agent, workflow, or explore examples.
          </p>
        </div>
      </div>
      <div className="home-v2-secondary-actions">
        {canWrite ? (
          <>
            <LinkButton variant="secondary" to="/agents/new">
              Create agent
            </LinkButton>
            <LinkButton variant="secondary" to="/workflows/new">
              Build workflow
            </LinkButton>
          </>
        ) : (
          <>
            <LinkButton variant="secondary" to="/agents">
              View agents
            </LinkButton>
            <LinkButton variant="secondary" to="/workflows">
              View workflows
            </LinkButton>
          </>
        )}
        <LinkButton variant="secondary" to="/examples">
          Discover examples
        </LinkButton>
      </div>
    </section>
  );
}
