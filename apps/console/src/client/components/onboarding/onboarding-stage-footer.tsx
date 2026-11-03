import { Link } from "react-router-dom";

import {
  GUIDED_ONBOARDING_VISUAL_STAGES,
  onboardingSearch,
  type GuidedVisualStageId,
  type OnboardingContext,
} from "../../lib/agent-onboarding";
import { LinkButton } from "../ui/button";

export function OnboardingStageFooter({
  context,
  viewedStageId,
  recommendedStageId,
}: {
  readonly context: OnboardingContext;
  readonly viewedStageId: GuidedVisualStageId;
  readonly recommendedStageId: GuidedVisualStageId;
}) {
  const index = GUIDED_ONBOARDING_VISUAL_STAGES.findIndex(
    (stage) => stage.id === viewedStageId,
  );
  const prev =
    index > 0 ? GUIDED_ONBOARDING_VISUAL_STAGES[index - 1] : undefined;
  const next =
    index >= 0 && index < GUIDED_ONBOARDING_VISUAL_STAGES.length - 1
      ? GUIDED_ONBOARDING_VISUAL_STAGES[index + 1]
      : undefined;

  return (
    <footer className="onboarding-v2-stage-footer">
      <div>
        {prev !== undefined ? (
          <Link
            className="button button-secondary"
            to={`/onboarding${onboardingSearch(context, { viewStage: prev.id })}`}
          >
            Previous: {prev.title}
          </Link>
        ) : (
          <LinkButton variant="ghost" to="/overview">
            Back to Home
          </LinkButton>
        )}
      </div>
      <div className="onboarding-v2-stage-footer-next">
        {viewedStageId !== recommendedStageId ? (
          <Link
            className="button button-ghost"
            to={`/onboarding${onboardingSearch(context, {
              viewStage: recommendedStageId,
            })}`}
          >
            Jump to current task
          </Link>
        ) : null}
        {next !== undefined ? (
          <Link
            className="button"
            to={`/onboarding${onboardingSearch(context, { viewStage: next.id })}`}
          >
            Next: {next.title}
          </Link>
        ) : null}
      </div>
    </footer>
  );
}
