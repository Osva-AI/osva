import { Link } from "react-router-dom";

import {
  deriveOnboardingProgress,
  noCodeFirstAgentSteps,
  type OnboardingProgressFlags,
} from "../../lib/agent-onboarding";
import type {
  AgentResource,
  AgentVersionResource,
} from "../../hooks/use-agents";
import type {
  ModelProfileResource,
  ModelProfileVersionResource,
  ModelProviderConnectionResource,
} from "../../hooks/use-models";
import type { RunResource } from "../../hooks/use-runs";
import type { WorkflowResource } from "../../hooks/use-workflows";
import { SectionPanel } from "../ui/section-panel";
import { LinkButton } from "../ui/button";

function onboardingPreviewSummary(flags: OnboardingProgressFlags): string {
  if (flags.progressIndeterminate) {
    return "First-agent progress is still loading from the API.";
  }
  if (flags.runsListIncomplete) {
    return "The loaded run page may not include every Run. Successful execution is not verified from this preview alone—open Getting started for the full history.";
  }
  if (flags.sampleRunSucceeded) {
    return "A Run reached SUCCEEDED for the onboarding agent version in loaded workspace data.";
  }
  if (flags.sampleRunSubmitted) {
    return "A Run exists for the onboarding path, but SUCCEEDED is not confirmed in the loaded run data.";
  }
  if (flags.publishedVersionReady && !flags.sampleRunSubmitted) {
    return "An AgentVersion is published. Launch and inspect a Run on Getting started when you are ready—this preview does not assume execution outcomes.";
  }
  return "Follow the steps below or open Getting started for the full checklist and run history.";
}

export function HomeGettingStartedPreview({
  agents,
  agentVersions,
  modelProfiles,
  modelProfileVersions,
  modelConnections,
  runs,
  runsListHasMore,
  workflows,
  progressLoading,
  progressLoadError,
  canWrite,
  canExecute,
}: {
  readonly agents: readonly AgentResource[] | undefined;
  readonly agentVersions:
    | ReadonlyArray<{
        readonly agentId: string;
        readonly versions: readonly AgentVersionResource[];
      }>
    | undefined;
  readonly modelProfiles: readonly ModelProfileResource[] | undefined;
  readonly modelProfileVersions:
    | ReadonlyArray<{
        readonly profileId: string;
        readonly versions: readonly ModelProfileVersionResource[];
      }>
    | undefined;
  readonly modelConnections:
    readonly ModelProviderConnectionResource[] | undefined;
  readonly runs: readonly RunResource[] | undefined;
  readonly runsListHasMore: boolean;
  readonly workflows: readonly WorkflowResource[] | undefined;
  readonly progressLoading: boolean;
  readonly progressLoadError: boolean;
  readonly canWrite: boolean;
  readonly canExecute: boolean;
}) {
  const progress = deriveOnboardingProgress({
    workspaceSelected: true,
    modelProfiles,
    modelProfileVersions,
    modelConnections,
    agents,
    agentVersions,
    runs,
    runsListHasMore,
    contextRun: undefined,
    workflows,
    context: {},
    progressLoading,
    progressLoadError,
  });

  const steps = noCodeFirstAgentSteps({}, progress).slice(0, 4);
  const currentStep = steps.find((step) => step.status === "current");
  const summary = onboardingPreviewSummary(progress);

  return (
    <SectionPanel
      title="Getting started"
      description="First-agent journey using real workspace data. Steps complete only when APIs confirm resources—not when a Run is merely created."
      actions={
        <LinkButton variant="secondary" to="/onboarding">
          Open full guide
        </LinkButton>
      }
    >
      {progressLoadError ? (
        <p className="muted">
          Onboarding progress could not be loaded. You can still open Getting
          started for the full checklist.
        </p>
      ) : progressLoading ? (
        <p className="muted">Loading first-agent progress…</p>
      ) : (
        <>
          {currentStep !== undefined ? (
            <article className="home-onboarding-current">
              <p className="home-onboarding-step-label">Suggested next step</p>
              <h3 className="home-onboarding-step-title">
                {currentStep.title}
              </h3>
              <p className="muted">{currentStep.statusDetail}</p>
              {(!currentStep.requiresWrite || canWrite) &&
              (!currentStep.requiresExecute || canExecute) ? (
                <Link className="button" to={currentStep.to}>
                  {currentStep.actionLabel}
                </Link>
              ) : (
                <p className="muted">
                  This step needs additional workspace permissions.
                </p>
              )}
            </article>
          ) : (
            <p className="muted">{summary}</p>
          )}
          <ol className="home-onboarding-mini-list">
            {steps.map((step) => (
              <li
                key={step.id}
                className={`home-onboarding-mini-${step.status}`}
              >
                <span className="home-onboarding-mini-title">{step.title}</span>
                <span className="muted">{step.statusDetail}</span>
              </li>
            ))}
          </ol>
        </>
      )}
    </SectionPanel>
  );
}
