import { forwardRef } from "react";
import { Link } from "react-router-dom";

import {
  developerOnboardingSteps,
  type OnboardingContext,
} from "../../lib/agent-onboarding";
import {
  HELLO_AGENT_GOLDEN_PATH_COMMAND,
  HELLO_AGENT_INPUT_EXAMPLE,
  HELLO_AGENT_OUTPUT_EXAMPLE,
  HELLO_AGENT_SOURCE_PATH,
} from "../../lib/agent-example";

const REQUIRES_WRITE_ROLE = "This step requires DEVELOPER, ADMIN, or OWNER.";
const REQUIRES_EXECUTE_ROLE =
  "This step requires OPERATOR, DEVELOPER, ADMIN, or OWNER.";

export const OnboardingDeveloperPath = forwardRef<
  HTMLDetailsElement,
  {
    readonly context: OnboardingContext;
    readonly canWrite: boolean;
    readonly canExecute: boolean;
    readonly open: boolean;
    readonly onOpenChange: (open: boolean) => void;
  }
>(function OnboardingDeveloperPath(
  { context, canWrite, canExecute, open, onOpenChange },
  ref,
) {
  return (
    <details
      ref={ref}
      id="developer-onboarding"
      className="onboarding-disclosure onboarding-developer-path"
      open={open}
      onToggle={(event) => {
        onOpenChange(event.currentTarget.open);
      }}
    >
      <summary>Developer / Hello Agent (advanced)</summary>
      <div className="onboarding-disclosure-body">
        <p className="muted">
          Code-based execution with trusted runtimes and the public Hello Agent
          example. Use when guided Agent Studio is not enough. Permissions still
          apply.
        </p>
        <details className="onboarding-disclosure onboarding-technical-disclosure">
          <summary>Technical reference</summary>
          <p className="muted">
            Golden path:{" "}
            <span className="mono">{HELLO_AGENT_GOLDEN_PATH_COMMAND}</span>.
            Source: <span className="mono">{HELLO_AGENT_SOURCE_PATH}</span>.
            Example I/O:{" "}
            <span className="mono">
              {JSON.stringify(HELLO_AGENT_INPUT_EXAMPLE)}
            </span>{" "}
            →{" "}
            <span className="mono">
              {JSON.stringify(HELLO_AGENT_OUTPUT_EXAMPLE)}
            </span>
          </p>
        </details>
        <ol className="onboarding-steps">
          {developerOnboardingSteps(context).map((step, index) => {
            const blockedWrite = step.requiresWrite === true && !canWrite;
            const blockedExecute = step.requiresExecute === true && !canExecute;
            const blocked = blockedWrite || blockedExecute;
            return (
              <li key={step.id}>
                <strong>
                  {index + 1}. {step.title}
                </strong>
                <p className="muted">{step.description}</p>
                {blocked ? (
                  <p className="muted">
                    {blockedWrite ? REQUIRES_WRITE_ROLE : REQUIRES_EXECUTE_ROLE}
                  </p>
                ) : (
                  <Link className="button button-secondary" to={step.to}>
                    {step.actionLabel}
                  </Link>
                )}
              </li>
            );
          })}
        </ol>
      </div>
    </details>
  );
});
