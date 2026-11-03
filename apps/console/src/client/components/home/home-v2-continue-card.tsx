import type { HomeResumeTarget } from "../../lib/home-v2-resume";
import { LinkButton } from "../ui/button";
import { HomeV2WorkflowIllustration } from "./home-v2-workflow-illustration";

export function HomeV2ContinueCard({
  target,
}: {
  readonly target: HomeResumeTarget;
}) {
  return (
    <section
      className="home-v2-primary-work"
      aria-labelledby="home-v2-continue-title"
    >
      <p className="home-v2-card-overline">
        {target.kind === "workflow" ? "Continue working" : "Your agent"}
      </p>
      <h2 id="home-v2-continue-title" className="home-v2-primary-title">
        {target.name}
      </h2>
      <p className="home-v2-primary-lead muted">{target.detail}</p>
      {target.kind === "workflow" ? <HomeV2WorkflowIllustration /> : null}
      <div className="home-v2-work-actions">
        <LinkButton variant="primary" to={target.href}>
          {target.primaryActionLabel}
        </LinkButton>
      </div>
    </section>
  );
}
