import { Link, useSearchParams } from "react-router-dom";

import { RuntimeReadinessPanel } from "../components/agent/runtime-readiness-panel";
import { useAgentVersionQuery } from "../hooks/use-agents";
import { useAuthContextQuery } from "../hooks/use-auth-context";
import {
  HELLO_AGENT_GOLDEN_PATH_COMMAND,
  HELLO_AGENT_INPUT_EXAMPLE,
  HELLO_AGENT_OUTPUT_EXAMPLE,
  HELLO_AGENT_SETUP_COMMANDS,
  HELLO_AGENT_SOURCE_PATH,
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
        <h2 className="panel-title">Hello Agent example</h2>
        <p>
          Use the supported public example at{" "}
          <span className="mono">examples/hello-agent</span>. It requires no
          paid model provider, performs no external network calls during
          execution, and uses normal Agent Registry APIs.
        </p>
        <p className="muted">
          Golden path:{" "}
          <span className="mono">{HELLO_AGENT_GOLDEN_PATH_COMMAND}</span>.
          Source entrypoint:{" "}
          <span className="mono">{HELLO_AGENT_SOURCE_PATH}</span>. Example
          input/output:{" "}
          <span className="mono">
            {JSON.stringify(HELLO_AGENT_INPUT_EXAMPLE)}
          </span>{" "}
          →{" "}
          <span className="mono">
            {JSON.stringify(HELLO_AGENT_OUTPUT_EXAMPLE)}
          </span>
        </p>
        <pre className="json-view">{HELLO_AGENT_SETUP_COMMANDS.join("\n")}</pre>
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
