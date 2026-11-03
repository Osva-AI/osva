import { useId } from "react";
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

export function OnboardingMobileProgress({
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
  const summaryId = useId();
  const viewedStage = GUIDED_ONBOARDING_VISUAL_STAGES.find(
    (stage) => stage.id === viewedStageId,
  )!;
  const viewedItem = deriveVisualStageStepperItemState(viewedStageId, {
    viewedStageId,
    recommendedStageId,
    flags,
    controlPlaneReachable,
  });
  const completeCount = GUIDED_ONBOARDING_VISUAL_STAGES.filter(
    (stage) =>
      deriveVisualStageStepperItemState(stage.id, {
        viewedStageId,
        recommendedStageId,
        flags,
        controlPlaneReachable,
      }).evidenceComplete,
  ).length;

  return (
    <nav
      className="onboarding-v2-progress-mobile"
      aria-label="Guided onboarding progress"
      data-testid="onboarding-mobile-progress"
    >
      <div className="onboarding-v2-progress-mobile-compact">
        <div className="onboarding-v2-progress-mobile-row">
          <span
            className="onboarding-v2-progress-mobile-step"
            aria-current="step"
          >
            Step {viewedStage.index} of 4
          </span>
          <span className="onboarding-v2-progress-mobile-status">
            {visualStageStepperStatusLabel(viewedItem)}
          </span>
        </div>
        <div
          className="onboarding-v2-progress-mobile-track"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={4}
          aria-valuenow={completeCount}
          aria-labelledby={summaryId}
        >
          {GUIDED_ONBOARDING_VISUAL_STAGES.map((stage) => {
            const item = deriveVisualStageStepperItemState(stage.id, {
              viewedStageId,
              recommendedStageId,
              flags,
              controlPlaneReachable,
            });
            let segmentClass = "onboarding-v2-progress-mobile-segment";
            if (item.evidenceComplete) {
              segmentClass += " is-complete";
            } else if (item.needsAttention) {
              segmentClass += " is-attention";
            } else if (item.isActionRequired) {
              segmentClass += " is-action";
            } else if (stage.id === viewedStageId) {
              segmentClass += " is-viewing";
            }
            return (
              <span
                key={stage.id}
                className={segmentClass}
                aria-hidden="true"
              />
            );
          })}
        </div>
        <p id={summaryId} className="sr-only">
          {completeCount} of 4 stages complete. Viewing {viewedStage.title}.{" "}
          {visualStageStepperStatusLabel(viewedItem)}.
        </p>
      </div>

      <details className="onboarding-v2-progress-mobile-expand">
        <summary>View all steps</summary>
        <ol className="onboarding-v2-progress-mobile-list">
          {GUIDED_ONBOARDING_VISUAL_STAGES.map((stage) => {
            const item = deriveVisualStageStepperItemState(stage.id, {
              viewedStageId,
              recommendedStageId,
              flags,
              controlPlaneReachable,
            });
            const href = `/onboarding${onboardingSearch(context, {
              viewStage: stage.id,
            })}`;
            return (
              <li key={stage.id}>
                <Link
                  className="onboarding-v2-progress-mobile-link"
                  to={href}
                  aria-current={stage.id === viewedStageId ? "step" : undefined}
                >
                  <span>
                    {stage.index}. {stage.title}
                  </span>
                  <span className="onboarding-v2-progress-mobile-link-state">
                    {visualStageStepperStatusLabel(item)}
                  </span>
                </Link>
              </li>
            );
          })}
        </ol>
      </details>
    </nav>
  );
}
