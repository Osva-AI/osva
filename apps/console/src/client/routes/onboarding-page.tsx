import { Link, useSearchParams } from "react-router-dom";

import { RuntimeReadinessPanel } from "../components/agent/runtime-readiness-panel";
import { ErrorState } from "../components/error-state/error-state";
import { LoadingBlock } from "../components/loading/loading-block";
import { WorkspaceSetupPanel } from "../components/workspace/workspace-setup-panel";
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
  deriveOnboardingProgress,
  developerOnboardingSteps,
  noCodeFirstAgentSteps,
  onboardingSearch,
  parseOnboardingContext,
} from "../lib/agent-onboarding";
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

  const noCodeSteps = noCodeFirstAgentSteps(context, progress);
  const developerSteps = developerOnboardingSteps(context);

  const onboardingContextLink = `/onboarding${onboardingSearch({
    agentId: context.agentId ?? progress.onboardingRun?.agentId,
    agentVersionId:
      context.agentVersionId ??
      progress.onboardingRun?.effectiveBindings.agentVersionId,
    runId: progress.onboardingRun?.id ?? context.runId,
  })}`;

  return (
    <>
      <header className="page-header">
        <div>
          <h1 className="page-title">Getting started</h1>
          <p className="page-subtitle">
            No-code first-agent journey using real workspace data. Progress
            marks complete only when APIs show the corresponding resources.
            Creating a Run is not the same as SUCCEEDED execution.
          </p>
        </div>
        <Link className="button button-secondary" to="/overview">
          Overview
        </Link>
      </header>

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
            <Link className="button" to="/agents/new">
              Create another agent
            </Link>
            <Link className="button button-secondary" to="/workflows/new">
              Build a workflow
            </Link>
          </div>
        </section>
      ) : null}

      <WorkspaceSetupPanel
        controlPlaneReachable={authQuery.data !== undefined}
        agents={agentsQuery.data?.agents}
        modelProfiles={modelProfilesQuery.data?.modelProfiles}
        modelConnections={modelConnectionsQuery.data?.connections}
        hasBoundProfileVersion={modelBindingQuery.data?.hasBoundProfileVersion}
      />

      <RuntimeReadinessPanel
        controlPlaneReachable={authQuery.data !== undefined}
        selectedVersion={versionQuery.data}
      />

      <section className="panel">
        <h2 className="panel-title">No-code first agent</h2>
        {progress.runsListIncomplete ? (
          <p className="muted" role="status">
            Run history is paginated ({ONBOARDING_RUNS_PAGE_LIMIT} most recent
            Runs loaded). If you already executed this AgentVersion, open Runs
            or pass <span className="mono">runId</span> in the URL to track a
            specific Run on this page.
          </p>
        ) : null}
        <ol className="onboarding-steps">
          {noCodeSteps.map((step, index) => {
            const blockedWrite = step.requiresWrite === true && !canWrite;
            const blockedExecute = step.requiresExecute === true && !canExecute;
            const blocked = blockedWrite || blockedExecute;
            return (
              <li
                key={step.id}
                className={`onboarding-step onboarding-step-${step.status}`}
              >
                <strong>
                  {index + 1}. {step.title}
                </strong>
                <p className="muted">{step.description}</p>
                <p className="onboarding-step-status" aria-live="polite">
                  {step.status === "complete"
                    ? "Complete"
                    : step.status === "current"
                      ? "Current"
                      : step.status === "blocked"
                        ? "Blocked"
                        : "Upcoming"}
                  {" — "}
                  {step.statusDetail}
                </p>
                {blocked ? (
                  <p className="muted">
                    {blockedWrite
                      ? ONBOARDING_REQUIRES_WRITE_ROLE
                      : ONBOARDING_REQUIRES_EXECUTE_ROLE}
                  </p>
                ) : (
                  <Link className="button" to={step.to}>
                    {step.actionLabel}
                  </Link>
                )}
              </li>
            );
          })}
        </ol>
        <p className="muted">
          Bookmark progress for this agent:{" "}
          <Link className="mono" to={onboardingContextLink}>
            {onboardingContextLink}
          </Link>
        </p>
      </section>

      <section className="panel" id="developer-onboarding">
        <h2 className="panel-title">Developer / Hello Agent (advanced)</h2>
        <p className="muted">
          Code-based execution with trusted runtimes and the public{" "}
          <span className="mono">examples/hello-agent</span> project. Use this
          when declarative Agent Studio is not sufficient.
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
