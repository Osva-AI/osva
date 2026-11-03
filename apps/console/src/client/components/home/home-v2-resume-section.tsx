import { LinkButton } from "../ui/button";
import { selectHomeResumeTarget } from "../../lib/home-v2-resume";
import type { HomePageData } from "../../hooks/use-home-page-data";

export function HomeV2ResumeSection({ data }: { readonly data: HomePageData }) {
  const target = selectHomeResumeTarget({
    agents: data.agents,
    workflows: data.workflows,
    recentRuns: data.recentRuns,
  });

  if (target === undefined) {
    return null;
  }

  return (
    <section className="home-v2-resume" aria-labelledby="home-v2-resume-title">
      <p className="home-v2-eyebrow">Continue working</p>
      <h2 id="home-v2-resume-title" className="home-v2-section-title">
        {target.name}
      </h2>
      <p className="home-v2-section-lead muted">{target.detail}</p>
      <LinkButton variant="primary" to={target.href}>
        {target.primaryActionLabel}
      </LinkButton>
    </section>
  );
}
