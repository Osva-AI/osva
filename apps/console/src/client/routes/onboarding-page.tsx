import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";

import { RuntimeReadinessPanel } from "../components/agent/runtime-readiness-panel";
import { ErrorState } from "../components/error-state/error-state";
import { LoadingBlock } from "../components/loading/loading-block";
import { OnboardingContextBanner } from "../components/onboarding/onboarding-context-banner";
import { OnboardingDeveloperPath } from "../components/onboarding/onboarding-developer-path";
import { OnboardingStageAside } from "../components/onboarding/onboarding-stage-aside";
import { OnboardingStageFooter } from "../components/onboarding/onboarding-stage-footer";
import { OnboardingStagePanel } from "../components/onboarding/onboarding-stage-panel";
import { OnboardingVisualStepper } from "../components/onboarding/onboarding-visual-stepper";
import { WorkspaceSetupPanel } from "../components/workspace/workspace-setup-panel";
import { Button, LinkButton } from "../components/ui/button";
import { PageHeader } from "../components/ui/page-header";
import {
  useAgentVersionCatalogQuery,
  useAgentVersionQuery,
  useAgentsListQuery,
} from "../hooks/use-agents";
import { useAuthContextQuery } from "../hooks/use-auth-context";
import {
  useModelBindingReadinessQuery,
  useModelProfilesListQuery,
  useModelProviderConnectionsListQuery,
} from "../hooks/use-models";
import { useRunQuery, useRunsListQuery } from "../hooks/use-runs";
import { useWorkflowsListQuery } from "../hooks/use-workflows";
import { useAuth } from "../context/auth-context";
import {
  deriveOnboardingJourneyState,
  deriveOnboardingProgress,
  deriveRecommendedVisualStage,
  findPrimaryOnboardingStep,
  noCodeFirstAgentSteps,
  onboardingSearch,
  parseOnboardingContext,
  parseOnboardingViewStage,
  type GuidedVisualStageId,
} from "../lib/agent-onboarding";
import { getExampleById } from "../lib/osva-examples-catalog";
import {
  roleCanExecuteControlPlaneActions,
  roleCanWriteControlPlaneResources,
} from "../lib/permissions";

const ONBOARDING_RUNS_PAGE_LIMIT = 25;

export function OnboardingPage() {
  const [searchParams] = useSearchParams();
  const context = parseOnboardingContext(searchParams);
  const parsedViewStage = parseOnboardingViewStage(searchParams);
  const exampleEntry =
    context.exampleId !== undefined
      ? getExampleById(context.exampleId)
      : undefined;
  const invalidExampleId =
    context.exampleId !== undefined && exampleEntry === undefined
      ? context.exampleId
      : undefined;

  const auth = useAuth();
  const authQuery = useAuthContextQuery();
  const versionQuery = useAgentVersionQuery(
    context.agentId,
    context.agentVersionId,
  );
  const agentsQuery = useAgentsListQuery();
  const versionCatalogQuery = useAgentVersionCatalogQuery();
  const runsQuery = useRunsListQuery({ limit: ONBOARDING_RUNS_PAGE_LIMIT });
  const contextRunQuery = useRunQuery(context.runId);
  const workflowsQuery = useWorkflowsListQuery();
  const modelBindingQuery = useModelBindingReadinessQuery();
  const modelProfilesQuery = useModelProfilesListQuery();
  const modelConnectionsQuery = useModelProviderConnectionsListQuery();

  const [developerPathOpen, setDeveloperPathOpen] = useState(false);
  const developerPathRef = useRef<HTMLDetailsElement>(null);

  const openDeveloperPath = useCallback(() => {
    setDeveloperPathOpen(true);
    requestAnimationFrame(() => {
      developerPathRef.current?.scrollIntoView({ behavior: "smooth" });
    });
  }, []);

  useEffect(() => {
    if (window.location.hash === "#developer-onboarding") {
      openDeveloperPath();
    }
  }, [openDeveloperPath]);

  const canWrite =
    authQuery.data !== undefined &&
    roleCanWriteControlPlaneResources(authQuery.data.role);
  const canExecute =
    authQuery.data !== undefined &&
    roleCanExecuteControlPlaneActions(authQuery.data.role);

  const progressLoading =
    agentsQuery.isLoading ||
    versionCatalogQuery.isLoading ||
    modelBindingQuery.isLoading ||
    modelProfilesQuery.isLoading ||
    modelConnectionsQuery.isLoading ||
    runsQuery.isLoading ||
    (context.runId !== undefined && contextRunQuery.isLoading);

  const progressLoadError =
    agentsQuery.isError ||
    versionCatalogQuery.isError ||
    modelBindingQuery.isError ||
    runsQuery.isError ||
    (context.runId !== undefined && contextRunQuery.isError);

  const progress = deriveOnboardingProgress({
    workspaceSelected: auth.selectedWorkspaceId !== undefined,
    modelProfiles: modelProfilesQuery.data?.modelProfiles,
    modelProfileVersions: modelBindingQuery.data?.profileVersions,
    modelConnections: modelConnectionsQuery.data?.connections,
    agents: agentsQuery.data?.agents,
    agentVersions: versionCatalogQuery.data?.entries,
    runs: runsQuery.data?.runs,
    runsListHasMore: runsQuery.data?.nextCursor !== undefined,
    contextRun: contextRunQuery.data,
    workflows: workflowsQuery.data?.workflows,
    context,
    progressLoading,
    progressLoadError,
  });

  const journeyState = deriveOnboardingJourneyState(
    progress,
    progressLoading,
    progressLoadError,
  );

  const noCodeSteps = noCodeFirstAgentSteps(context, progress);
  const primaryStep = findPrimaryOnboardingStep(noCodeSteps);
  const optionalWorkflowStep = noCodeSteps.find(
    (step) => step.id === "workflow",
  );

  const controlPlaneReachable = authQuery.data !== undefined;
  const recommendedStageId = deriveRecommendedVisualStage({
    primaryGranularStepId: primaryStep?.id,
    flags: progress,
    controlPlaneReachable,
  });
  const viewedStageId: GuidedVisualStageId =
    parsedViewStage ?? recommendedStageId;

  const onboardingContextLink = `/onboarding${onboardingSearch(
    {
      agentId: context.agentId ?? progress.onboardingRun?.agentId,
      agentVersionId:
        context.agentVersionId ??
        progress.onboardingRun?.effectiveBindings.agentVersionId,
      runId: progress.onboardingRun?.id ?? context.runId,
      exampleId: exampleEntry?.id,
    },
    { viewStage: viewedStageId },
  )}`;

  const showPrimaryContent = !progressLoading && !progressLoadError;
  const showSuccessExperience =
    progress.sampleRunSucceeded &&
    !progress.progressIndeterminate &&
    !progressLoadError;

  return (
    <div className="onboarding-v2-page">
      <PageHeader
        title="Get your first agent running"
        subtitle="A short guided path to configure your workspace, create an agent, and confirm a successful test."
        actions={
          <>
            <LinkButton variant="secondary" to="/overview">
              Go to Home
            </LinkButton>
            {!showSuccessExperience ? (
              <Button variant="ghost" type="button" onClick={openDeveloperPath}>
                Developer path
              </Button>
            ) : null}
          </>
        }
      />

      {!showSuccessExperience ? (
        <OnboardingContextBanner
          workspace={auth.selectedWorkspace}
          journeyState={journeyState}
          context={context}
          exampleTitle={exampleEntry?.title}
          invalidExampleId={invalidExampleId}
        />
      ) : null}

      {progressLoadError ? (
        <ErrorState
          title="Could not load onboarding progress"
          error={
            agentsQuery.error ??
            versionCatalogQuery.error ??
            modelBindingQuery.error ??
            runsQuery.error ??
            contextRunQuery.error ??
            new Error("One or more workspace queries failed.")
          }
        />
      ) : null}

      {progressLoading && !progressLoadError ? (
        <LoadingBlock label="Loading onboarding progress…" />
      ) : null}

      {showSuccessExperience ? (
        <section
          className="panel onboarding-v2-completion"
          role="status"
          data-testid="onboarding-completion"
        >
          <p className="onboarding-v2-stage-eyebrow">You did it</p>
          <h2 className="onboarding-v2-completion-title">
            Your first agent test succeeded
          </h2>
          <p className="muted onboarding-v2-completion-lead">
            The sample task finished successfully in this workspace. Review the
            output, then explore workflows or build another agent when you are
            ready.
          </p>
          <div className="toolbar">
            {progress.onboardingRun !== undefined ? (
              <Link
                className="button primary"
                to={`/runs/${encodeURIComponent(progress.onboardingRun.id)}`}
              >
                Open run output
              </Link>
            ) : null}
            {context.agentId !== undefined &&
            context.agentVersionId !== undefined ? (
              <Link
                className="button"
                to={`/agents/${encodeURIComponent(context.agentId)}/versions/${encodeURIComponent(context.agentVersionId)}`}
              >
                Open agent details
              </Link>
            ) : null}
            <Link className="button" to="/workflows/new">
              Build a workflow
            </Link>
            <Link className="button button-secondary" to="/overview">
              Return Home
            </Link>
          </div>
          {optionalWorkflowStep !== undefined && canWrite ? (
            <div className="onboarding-v2-completion-secondary">
              <p className="muted">{optionalWorkflowStep.description}</p>
              <LinkButton variant="secondary" to={optionalWorkflowStep.to}>
                {optionalWorkflowStep.actionLabel}
              </LinkButton>
            </div>
          ) : null}
          <details className="onboarding-technical-disclosure">
            <summary>Technical details</summary>
            <p className="muted">
              Run{" "}
              <span className="mono">
                {progress.onboardingRun?.id ?? context.runId}
              </span>{" "}
              reached status SUCCEEDED in loaded workspace data.
              {context.agentVersionId !== undefined ? (
                <>
                  {" "}
                  Immutable AgentVersion{" "}
                  <span className="mono">{context.agentVersionId}</span>.
                </>
              ) : null}
            </p>
          </details>
        </section>
      ) : null}

      {showPrimaryContent && !showSuccessExperience ? (
        <>
          <OnboardingVisualStepper
            context={context}
            viewedStageId={viewedStageId}
            recommendedStageId={recommendedStageId}
            flags={progress}
            controlPlaneReachable={controlPlaneReachable}
          />

          <div className="onboarding-v2-grid">
            <OnboardingStagePanel
              stageId={viewedStageId}
              recommendedStageId={recommendedStageId}
              flags={progress}
              context={context}
              controlPlaneReachable={controlPlaneReachable}
              primaryGranularStep={
                viewedStageId === recommendedStageId ? primaryStep : undefined
              }
              canWrite={canWrite}
              canExecute={canExecute}
              agents={agentsQuery.data?.agents}
              modelProfiles={modelProfilesQuery.data?.modelProfiles}
              modelProfileVersions={modelBindingQuery.data?.profileVersions}
              modelConnections={modelConnectionsQuery.data?.connections}
              exampleEntry={exampleEntry}
            />
            <OnboardingStageAside stageId={viewedStageId} />
          </div>

          <OnboardingStageFooter
            context={context}
            viewedStageId={viewedStageId}
            recommendedStageId={recommendedStageId}
          />

          <details className="onboarding-disclosure">
            <summary>Workspace setup and readiness details</summary>
            <div className="onboarding-disclosure-body">
              <WorkspaceSetupPanel
                controlPlaneReachable={controlPlaneReachable}
                agents={agentsQuery.data?.agents}
                modelProfiles={modelProfilesQuery.data?.modelProfiles}
                modelConnections={modelConnectionsQuery.data?.connections}
                hasBoundProfileVersion={
                  modelBindingQuery.data?.hasBoundProfileVersion
                }
              />
              <RuntimeReadinessPanel
                controlPlaneReachable={controlPlaneReachable}
                selectedVersion={versionQuery.data}
              />
            </div>
          </details>

          <p className="muted onboarding-resume-link">
            Resume or share this guide:{" "}
            <Link className="mono" to={onboardingContextLink}>
              {onboardingContextLink}
            </Link>
          </p>

          <OnboardingDeveloperPath
            ref={developerPathRef}
            context={context}
            canWrite={canWrite}
            canExecute={canExecute}
            open={developerPathOpen}
            onOpenChange={setDeveloperPathOpen}
          />
        </>
      ) : null}
    </div>
  );
}
