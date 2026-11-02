import { Link, useSearchParams } from "react-router-dom";

import { RuntimeReadinessPanel } from "../components/agent/runtime-readiness-panel";
import { ErrorState } from "../components/error-state/error-state";
import { LoadingBlock } from "../components/loading/loading-block";
import { OnboardingContextBanner } from "../components/onboarding/onboarding-context-banner";
import { OnboardingPrimaryStep } from "../components/onboarding/onboarding-primary-step";
import {
  OnboardingProgressStepper,
  onboardingStepperSummary,
} from "../components/onboarding/onboarding-progress-stepper";
import { WorkspaceSetupPanel } from "../components/workspace/workspace-setup-panel";
import { LinkButton } from "../components/ui/button";
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
  HELLO_AGENT_GOLDEN_PATH_COMMAND,
  HELLO_AGENT_INPUT_EXAMPLE,
  HELLO_AGENT_OUTPUT_EXAMPLE,
  HELLO_AGENT_SOURCE_PATH,
} from "../lib/agent-example";
import {
  deriveOnboardingJourneyState,
  deriveOnboardingProgress,
  developerOnboardingSteps,
  findPrimaryOnboardingStep,
  guidedOnboardingCoreSteps,
  noCodeFirstAgentSteps,
  onboardingSearch,
  parseOnboardingContext,
} from "../lib/agent-onboarding";
import { getExampleById } from "../lib/osva-examples-catalog";
import {
  roleCanExecuteControlPlaneActions,
  roleCanWriteControlPlaneResources,
} from "../lib/permissions";

const ONBOARDING_REQUIRES_WRITE_ROLE =
  "This step requires DEVELOPER, ADMIN, or OWNER.";
const ONBOARDING_REQUIRES_EXECUTE_ROLE =
  "This step requires OPERATOR, DEVELOPER, ADMIN, or OWNER.";

const ONBOARDING_RUNS_PAGE_LIMIT = 25;

export function OnboardingPage() {
  const [searchParams] = useSearchParams();
  const context = parseOnboardingContext(searchParams);
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
  const coreSteps = guidedOnboardingCoreSteps(noCodeSteps);
  const primaryStep = findPrimaryOnboardingStep(noCodeSteps);
  const stepperSummary = onboardingStepperSummary(coreSteps, progress);
  const developerSteps = developerOnboardingSteps(context);
  const optionalWorkflowStep = noCodeSteps.find(
    (step) => step.id === "workflow",
  );

  const onboardingContextLink = `/onboarding${onboardingSearch({
    agentId: context.agentId ?? progress.onboardingRun?.agentId,
    agentVersionId:
      context.agentVersionId ??
      progress.onboardingRun?.effectiveBindings.agentVersionId,
    runId: progress.onboardingRun?.id ?? context.runId,
    exampleId: exampleEntry?.id,
  })}`;

  const showPrimaryContent = !progressLoading && !progressLoadError;

  return (
    <>
      <PageHeader
        title="Get your first agent running"
        subtitle="A guided path from workspace setup to a successful test Run. Progress reflects real API evidence in this workspace—creating a Run is not the same as SUCCEEDED execution."
        actions={
          <>
            <LinkButton variant="secondary" to="/overview">
              Go to Home
            </LinkButton>
            <LinkButton variant="ghost" to="#developer-onboarding">
              Developer path
            </LinkButton>
          </>
        }
      />

      <OnboardingContextBanner
        workspace={auth.selectedWorkspace}
        journeyState={journeyState}
        context={context}
        exampleTitle={exampleEntry?.title}
        invalidExampleId={invalidExampleId}
      />

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

      {progress.sampleRunSucceeded &&
      !progress.progressIndeterminate &&
      !progressLoadError ? (
        <section className="panel onboarding-step-complete" role="status">
          <h2 className="panel-title">First agent run succeeded</h2>
          <p className="muted">
            Run{" "}
            <span className="mono">
              {progress.onboardingRun?.id ?? context.runId}
            </span>{" "}
            reached SUCCEEDED in this workspace. Inspect persisted output on Run
            Detail, then explore workflows or additional agents when ready.
          </p>
          <div className="toolbar">
            {progress.onboardingRun !== undefined ? (
              <Link
                className="button primary"
                to={`/runs/${encodeURIComponent(progress.onboardingRun.id)}`}
              >
                Open Run output
              </Link>
            ) : null}
            {context.agentId !== undefined &&
            context.agentVersionId !== undefined ? (
              <Link
                className="button"
                to={`/agents/${encodeURIComponent(context.agentId)}/versions/${encodeURIComponent(context.agentVersionId)}`}
              >
                View AgentVersion
              </Link>
            ) : null}
            <Link className="button" to="/workflows/new">
              Build a workflow
            </Link>
            <Link className="button button-secondary" to="/overview">
              Return Home
            </Link>
          </div>
        </section>
      ) : null}

      {showPrimaryContent ? (
        <>
          <section className="panel onboarding-guided-overview">
            <div className="panel-header-row">
              <div>
                <h2 className="panel-title">Progress overview</h2>
                <p className="panel-description muted">
                  {stepperSummary.completeCount} of {coreSteps.length} core
                  stages complete
                  {stepperSummary.currentVisual === "needs_attention"
                    ? " · one stage needs attention"
                    : ""}
                  . Optional workflow exploration appears after your first
                  success.
                </p>
              </div>
            </div>
            {progress.runsListIncomplete ? (
              <p className="muted" role="status">
                Run history is paginated ({ONBOARDING_RUNS_PAGE_LIMIT} most
                recent Runs loaded). Open Runs or add{" "}
                <span className="mono">runId</span> to the URL to track a
                specific Run.
              </p>
            ) : null}
            <OnboardingProgressStepper steps={coreSteps} flags={progress} />
          </section>

          {primaryStep !== undefined &&
          primaryStep.id !== "workflow" &&
          !progress.sampleRunSucceeded ? (
            <OnboardingPrimaryStep
              step={primaryStep}
              flags={progress}
              canWrite={canWrite}
              canExecute={canExecute}
            />
          ) : null}

          {progress.sampleRunSucceeded && optionalWorkflowStep !== undefined ? (
            <section className="panel onboarding-optional-workflow">
              <h2 className="panel-title">{optionalWorkflowStep.title}</h2>
              <p className="muted">{optionalWorkflowStep.description}</p>
              <p className="muted">{optionalWorkflowStep.statusDetail}</p>
              {canWrite ? (
                <LinkButton variant="secondary" to={optionalWorkflowStep.to}>
                  {optionalWorkflowStep.actionLabel}
                </LinkButton>
              ) : (
                <p className="muted">{ONBOARDING_REQUIRES_WRITE_ROLE}</p>
              )}
            </section>
          ) : null}

          <details className="onboarding-disclosure">
            <summary>Workspace setup and readiness details</summary>
            <div className="onboarding-disclosure-body">
              <WorkspaceSetupPanel
                controlPlaneReachable={authQuery.data !== undefined}
                agents={agentsQuery.data?.agents}
                modelProfiles={modelProfilesQuery.data?.modelProfiles}
                modelConnections={modelConnectionsQuery.data?.connections}
                hasBoundProfileVersion={
                  modelBindingQuery.data?.hasBoundProfileVersion
                }
              />
              <RuntimeReadinessPanel
                controlPlaneReachable={authQuery.data !== undefined}
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
        </>
      ) : null}

      <section className="panel" id="developer-onboarding">
        <h2 className="panel-title">Developer / Hello Agent (advanced)</h2>
        <p className="muted">
          Code-based execution with trusted runtimes and the public{" "}
          <span className="mono">examples/hello-agent</span> project. Use this
          when declarative Agent Studio is not sufficient. Skipping the guide
          above does not bypass model, publish, or execute permissions.
        </p>
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
        <ol className="onboarding-steps">
          {developerSteps.map((step, index) => {
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
                    {blockedWrite
                      ? ONBOARDING_REQUIRES_WRITE_ROLE
                      : ONBOARDING_REQUIRES_EXECUTE_ROLE}
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
      </section>
    </>
  );
}
