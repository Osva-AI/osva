import { Link, useSearchParams } from "react-router-dom";

import { RuntimeReadinessPanel } from "../components/agent/runtime-readiness-panel";
import { useAgentVersionQuery } from "../hooks/use-agents";
import { useAuthContextQuery } from "../hooks/use-auth-context";
import {
  ECHO_AGENT_FIXTURE_PATH,
  ECHO_AGENT_INPUT_EXAMPLE,
  ECHO_AGENT_SETUP_COMMANDS,
} from "../lib/agent-example";
import {
  firstAgentOnboardingSteps,
  parseOnboardingContext,
} from "../lib/agent-onboarding";
import {
  roleCanExecuteControlPlaneActions,
  roleCanWriteControlPlaneResources,
} from "../lib/permissions";

export function OnboardingPage() {
  const [searchParams] = useSearchParams();
  const context = parseOnboardingContext(searchParams);
  const authQuery = useAuthContextQuery();
  const versionQuery = useAgentVersionQuery(
    context.agentId,
    context.agentVersionId,
  );
  const canWrite =
    authQuery.data !== undefined &&
    roleCanWriteControlPlaneResources(authQuery.data.role);
  const canExecute =
    authQuery.data !== undefined &&
    roleCanExecuteControlPlaneActions(authQuery.data.role);
  const steps = firstAgentOnboardingSteps(context);

  return (
    <>
      <header className="page-header">
        <div>
          <h1 className="page-title">First-agent onboarding</h1>
          <p className="page-subtitle">
            Guided path through existing Console pages and APIs. Secrets never
            belong in URL parameters or browser storage.
          </p>
        </div>
        <Link className="button" to="/agents">
          Agent Registry
        </Link>
      </header>

      <RuntimeReadinessPanel
        controlPlaneReachable={authQuery.data !== undefined}
        selectedVersion={versionQuery.data}
      />

      <section className="panel">
        <h2 className="panel-title">Deterministic example</h2>
        <p>
          Prefer the trusted TypeScript echo agent. It requires no paid model
          provider, echoes the Run input, and is registered through the public
          Agent Registry APIs.
        </p>
        <p className="muted">
          Copy <span className="mono">{ECHO_AGENT_FIXTURE_PATH}</span> under{" "}
          <span className="mono">OSVA_TRUSTED_RUNTIME_ROOT</span>, compute
          integrity, then register the Agent and append an AgentVersion. Example
          input:{" "}
          <span className="mono">
            {JSON.stringify(ECHO_AGENT_INPUT_EXAMPLE)}
          </span>
        </p>
        <pre className="json-view">{ECHO_AGENT_SETUP_COMMANDS.join("\n")}</pre>
      </section>

      <section className="panel">
        <h2 className="panel-title">Journey</h2>
        <ol className="onboarding-steps">
          {steps.map((step, index) => {
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
                      ? "This step requires EDITOR or ADMIN."
                      : "This step requires OPERATOR, EDITOR, or ADMIN."}
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
    </>
  );
}
