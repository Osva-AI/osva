import { LinkButton } from "../ui/button";

export function HomeV2GuidedFoot() {
  return (
    <div className="home-v2-quiet-foot">
      <div className="home-v2-quiet-details">
        <span className="home-v2-quiet-icon" aria-hidden="true">
          ?
        </span>
        <span>
          <strong>Not sure where to begin?</strong>
          <p className="muted">
            Guided setup walks you through what&apos;s required, one step at a
            time.
          </p>
        </span>
      </div>
      <LinkButton variant="secondary" to="/onboarding">
        View the guided path
      </LinkButton>
    </div>
  );
}
