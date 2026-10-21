import { Link, useSearchParams } from "react-router-dom";

import { RuntimeReadinessPanel } from "../components/agent/runtime-readiness-panel";
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
import { useRunsListQuery } from "../hooks/use-runs";
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
  const runsQuery = useRunsListQuery({ limit: 25 });
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

  const progress = deriveOnboardingProgress({
    workspaceSelected: auth.selectedWorkspaceId !== undefined,
    modelProfiles: modelProfilesQuery.data?.modelProfiles,
    modelProfileVersions: modelBindingQuery.data?.profileVersions,
    modelConnections: modelConnectionsQuery.data?.connections,
    agents: agentsQuery.data?.agents,
    agentVersions: versionCatalogQuery.data?.entries,
    runs: runsQuery.data?.runs,
    workflows: workflowsQuery.data?.workflows,
    context,
  });

  const noCodeSteps = noCodeFirstAgentSteps(context, progress);
  const developerSteps = developerOnboardingSteps(context);

  const loadingProgress =
    agentsQuery.isLoading ||
    versionCatalogQuery.isLoading ||
    modelBindingQuery.isLoading;

  return (
    <>
      <header className="page-header">
        <div>
          <h1 className="page-title">Getting started</h1>
          <p className="page-subtitle">
            No-code first-agent journey using real workspace data. Progress
            marks complete only when APIs show the corresponding resources.
          </p>
        </div>
        <Link className="button button-secondary" to="/overview">
          Overview
        </Link>
      </header>

      {loadingProgress ? (
        <LoadingBlock label="Loading onboarding progress…" />
      ) : null}

      <WorkspaceSetupPanel
        controlPlaneReachable={authQuery.data !== undefined}
        agents={agentsQuery.data?.agents}
        modelProfiles={modelProfilesQuery.data?.modelProfiles}
        modelConnections={modelConnectionsQuery.data?.connections}
      />

      <RuntimeReadinessPanel
        controlPlaneReachable={authQuery.data !== undefined}
        selectedVersion={versionQuery.data}
      />

      <section className="panel">
        <h2 className="panel-title">No-code first agent</h2>
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
