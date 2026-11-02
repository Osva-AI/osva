import { LinkButton } from "../ui/button";
import type { NoCodeOnboardingStep } from "../../lib/agent-onboarding";
import {
  guidedStepVisualLabel,
  guidedStepVisualState,
  type OnboardingProgressFlags,
} from "../../lib/agent-onboarding";

const REQUIRES_WRITE_ROLE =
  "This step requires DEVELOPER, ADMIN, or OWNER in this workspace.";
const REQUIRES_EXECUTE_ROLE =
  "This step requires OPERATOR, DEVELOPER, ADMIN, or OWNER.";

export function OnboardingPrimaryStep({
  step,
  flags,
  canWrite,
  canExecute,
}: {
  readonly step: NoCodeOnboardingStep;
  readonly flags: OnboardingProgressFlags;
  readonly canWrite: boolean;
  readonly canExecute: boolean;
}) {
  const visual = guidedStepVisualState(step, flags);
  const blockedWrite = step.requiresWrite === true && !canWrite;
  const blockedExecute = step.requiresExecute === true && !canExecute;
  const blocked = blockedWrite || blockedExecute;

  return (
    <article
      className="panel onboarding-primary-step"
      data-testid="onboarding-primary-step"
      aria-labelledby="onboarding-primary-step-title"
    >
      <p className="onboarding-primary-step-kicker">Your current step</p>
      <h2 className="panel-title" id="onboarding-primary-step-title">
        {step.title}
      </h2>
      <p className="muted">{step.description}</p>
      <p className="onboarding-step-status" aria-live="polite">
        {guidedStepVisualLabel(visual)} — {step.statusDetail}
      </p>
      {blocked ? (
        <p className="muted" role="status">
          {blockedWrite ? REQUIRES_WRITE_ROLE : REQUIRES_EXECUTE_ROLE}
        </p>
      ) : (
        <div className="toolbar">
          <LinkButton variant="primary" to={step.to}>
            {step.actionLabel}
          </LinkButton>
        </div>
      )}
    </article>
  );
}
