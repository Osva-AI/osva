import { Link } from "react-router-dom";

import { OSVA_EXAMPLE_CATALOG } from "../../lib/osva-examples-catalog";
import { onboardingSearch } from "../../lib/agent-onboarding";
import type { OnboardingContext } from "../../lib/agent-onboarding";
import { OnboardingRecoveryDialog } from "./onboarding-recovery-dialog";

const IDEA_EXAMPLE_IDS = [
  "01-minimal-agent",
  "06-customer-support-worker",
  "04-seo-worker",
] as const;

export function OnboardingExampleIdeasDialog({
  open,
  context,
  onClose,
}: {
  readonly open: boolean;
  readonly context: OnboardingContext;
  readonly onClose: () => void;
}) {
  const ideas = IDEA_EXAMPLE_IDS.map((id) =>
    OSVA_EXAMPLE_CATALOG.find((entry) => entry.id === id),
  ).filter((entry) => entry !== undefined);

  return (
    <OnboardingRecoveryDialog
      open={open}
      title="Example ideas (not automatic import)"
      description="These curated osva-examples entries can inspire your agent's purpose. They are not one-click deployable templates until a supported import flow exists."
      onClose={onClose}
    >
      <ul className="onboarding-example-ideas-list">
        {ideas.map((entry) => (
          <li key={entry.id}>
            <strong>{entry.title}</strong>
            <p className="muted">{entry.description}</p>
            <div className="toolbar">
              <Link
                className="button button-secondary"
                to={`/onboarding${onboardingSearch({ ...context, exampleId: entry.id })}`}
                onClick={onClose}
              >
                Use as onboarding context
              </Link>
              <Link
                className="button button-ghost"
                to={`/examples/${encodeURIComponent(entry.id)}`}
                onClick={onClose}
              >
                View example details
              </Link>
            </div>
          </li>
        ))}
      </ul>
    </OnboardingRecoveryDialog>
  );
}
