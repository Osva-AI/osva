import { LinkButton } from "../ui/button";

export function HomeV2ReturnHeader({
  canWrite,
}: {
  readonly canWrite: boolean;
}) {
  return (
    <header className="home-v2-return-head">
      <div>
        <p className="home-v2-eyebrow">Welcome back</p>
        <h1 className="home-v2-return-title">Pick up where you left off.</h1>
        <p className="home-v2-return-lead muted">
          Continue your work or take care of something that needs attention.
        </p>
      </div>
      {canWrite ? (
        <LinkButton variant="primary" to="/agents/new">
          Create new
        </LinkButton>
      ) : null}
    </header>
  );
}
