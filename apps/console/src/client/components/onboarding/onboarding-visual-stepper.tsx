import { Link } from "react-router-dom";

import {
  GUIDED_ONBOARDING_VISUAL_STAGES,
  deriveVisualStageStepperItemState,
  onboardingSearch,
  visualStageStepperStatusLabel,
  type GuidedVisualStageId,
  type OnboardingContext,
  type OnboardingProgressFlags,
} from "../../lib/agent-onboarding";
import { OnboardingMobileProgress } from "./onboarding-mobile-progress";

function stepperItemClassName(
  state: ReturnType<typeof deriveVisualStageStepperItemState>,
): string {
  const parts = ["onboarding-v2-progress-item"];
  if (state.evidenceComplete) {
    parts.push("onboarding-v2-progress-complete");
  } else if (state.needsAttention) {
    parts.push("onboarding-v2-progress-needs_attention");
  } else if (state.isActionRequired) {
    parts.push("onboarding-v2-progress-action");
  } else if (state.isViewing) {
    parts.push("onboarding-v2-progress-viewing");
  } else if (state.notVerified) {
    parts.push("onboarding-v2-progress-not_verified");
  } else {
    parts.push("onboarding-v2-progress-upcoming");
  }
  return parts.join(" ");
}

export function OnboardingVisualStepper({
  context,
  viewedStageId,
  recommendedStageId,
  flags,
  controlPlaneReachable,
}: {
  readonly context: OnboardingContext;
  readonly viewedStageId: GuidedVisualStageId;
  readonly recommendedStageId: GuidedVisualStageId;
  readonly flags: OnboardingProgressFlags;
  readonly controlPlaneReachable: boolean;
}) {
  return (
    <>
      <OnboardingMobileProgress
        context={context}
        viewedStageId={viewedStageId}
        recommendedStageId={recommendedStageId}
        flags={flags}
        controlPlaneReachable={controlPlaneReachable}
      />
      <nav
        className="onboarding-v2-progress onboarding-v2-progress-desktop"
        aria-label="Guided onboarding progress"
      >
        <ol className="onboarding-v2-progress-list">
          {GUIDED_ONBOARDING_VISUAL_STAGES.map((stage) => {
            const item = deriveVisualStageStepperItemState(stage.id, {
              viewedStageId,
              recommendedStageId,
              flags,
              controlPlaneReachable,
            });
            const isViewing = stage.id === viewedStageId;
            const href = `/onboarding${onboardingSearch(context, {
              viewStage: stage.id,
            })}`;
            return (
              <li
                key={stage.id}
                className={stepperItemClassName(item)}
                aria-current={isViewing ? "step" : undefined}
              >
                <Link className="onboarding-v2-progress-link" to={href}>
                  <span
                    className="onboarding-v2-progress-num"
                    aria-hidden="true"
                  >
                    {stage.index}
                  </span>
                  <span className="onboarding-v2-progress-text">
                    <span className="onboarding-v2-progress-title">
                      {stage.title}
                    </span>
                    <span className="onboarding-v2-progress-state">
                      {visualStageStepperStatusLabel(item)}
                    </span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ol>
      </nav>
    </>
  );
}
