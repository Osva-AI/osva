import type {
  GuidedStepVisualState,
  NoCodeOnboardingStep,
  OnboardingProgressFlags,
} from "../../lib/agent-onboarding";
import {
  guidedStepVisualLabel,
  guidedStepVisualState,
} from "../../lib/agent-onboarding";

export function OnboardingProgressStepper({
  steps,
  flags,
}: {
  readonly steps: readonly NoCodeOnboardingStep[];
  readonly flags: OnboardingProgressFlags;
}) {
  return (
    <nav
      className="onboarding-guided-stepper"
      aria-label="First agent progress"
    >
      <ol className="onboarding-guided-stepper-list">
        {steps.map((step, index) => {
          const visual = guidedStepVisualState(step, flags);
          const isCurrent =
            visual === "current" || visual === "needs_attention";
          return (
            <li
              key={step.id}
              className={`onboarding-guided-step onboarding-guided-step-${visual}`}
              aria-current={isCurrent ? "step" : undefined}
            >
              <span className="onboarding-guided-step-index" aria-hidden="true">
                {index + 1}
              </span>
              <span className="onboarding-guided-step-body">
                <span className="onboarding-guided-step-title">
                  {step.title}
                </span>
                <span className="onboarding-guided-step-state">
                  {guidedStepVisualLabel(visual)}
                </span>
              </span>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

export function onboardingStepperSummary(
  steps: readonly NoCodeOnboardingStep[],
  flags: OnboardingProgressFlags,
): {
  readonly completeCount: number;
  readonly currentVisual: GuidedStepVisualState | undefined;
} {
  let completeCount = 0;
  let currentVisual: GuidedStepVisualState | undefined;
  for (const step of steps) {
    const visual = guidedStepVisualState(step, flags);
    if (visual === "complete") {
      completeCount += 1;
    }
    if (visual === "current" || visual === "needs_attention") {
      currentVisual = visual;
    }
  }
  return { completeCount, currentVisual };
}
