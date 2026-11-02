import type { WorkspaceMembershipSummary } from "../../context/auth-context";
import type {
  OnboardingContext,
  OnboardingJourneyState,
} from "../../lib/agent-onboarding";

function journeyStateLabel(state: OnboardingJourneyState): string {
  switch (state) {
    case "loading":
      return "Loading progress from the API…";
    case "not_started":
      return "Select a workspace to begin.";
    case "in_progress":
      return "Configuration in progress.";
    case "ready_to_test":
      return "Ready to launch a test Run.";
    case "running":
      return "A Run is in progress.";
    case "succeeded":
      return "First Run reached SUCCEEDED.";
    case "failed":
      return "Last Run did not succeed — review and retry.";
    case "indeterminate":
      return "Progress could not be verified.";
    case "blocked":
      return "Waiting on prerequisites.";
    default:
      return "In progress.";
  }
}

export function OnboardingContextBanner({
  workspace,
  journeyState,
  context,
  exampleTitle,
  invalidExampleId,
}: {
  readonly workspace: WorkspaceMembershipSummary | undefined;
  readonly journeyState: OnboardingJourneyState;
  readonly context: OnboardingContext;
  readonly exampleTitle?: string;
  readonly invalidExampleId?: string;
}) {
  const hasResourceContext =
    context.agentId !== undefined ||
    context.agentVersionId !== undefined ||
    context.runId !== undefined;

  return (
    <section
      className="onboarding-context-banner"
      aria-label="Onboarding context"
    >
      <div className="onboarding-context-row">
        <span className="onboarding-context-label">Workspace</span>
        <span className="onboarding-context-value">
          {workspace?.name ?? "No workspace selected"}
          {workspace !== undefined ? (
            <span className="muted"> · {workspace.role}</span>
          ) : null}
        </span>
      </div>
      <div className="onboarding-context-row">
        <span className="onboarding-context-label">Journey</span>
        <span className="onboarding-context-value">
          {journeyStateLabel(journeyState)}
        </span>
      </div>
      {hasResourceContext ? (
        <div className="onboarding-context-row">
          <span className="onboarding-context-label">Tracking</span>
          <span className="onboarding-context-value mono onboarding-context-tracking">
            {context.agentId !== undefined ? (
              <span>agent {context.agentId}</span>
            ) : null}
            {context.agentVersionId !== undefined ? (
              <span> · version {context.agentVersionId}</span>
            ) : null}
            {context.runId !== undefined ? (
              <span> · run {context.runId}</span>
            ) : null}
          </span>
        </div>
      ) : null}
      {exampleTitle !== undefined ? (
        <div className="onboarding-context-row">
          <span className="onboarding-context-label">Example</span>
          <span className="onboarding-context-value">{exampleTitle}</span>
        </div>
      ) : null}
      {invalidExampleId !== undefined ? (
        <p className="muted" role="status">
          Example <span className="mono">{invalidExampleId}</span> is not in the
          curated catalog. Progress uses workspace resources only.
        </p>
      ) : null}
    </section>
  );
}
