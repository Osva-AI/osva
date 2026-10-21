import { Link } from "react-router-dom";

import { AgentPlaygroundPanel } from "../components/agent/agent-playground-panel";
import { useAuthContextQuery } from "../hooks/use-auth-context";
import { roleCanExecuteControlPlaneActions } from "../lib/permissions";

export function AgentPlaygroundPage() {
  const authQuery = useAuthContextQuery();
  const canExecute =
    authQuery.data !== undefined &&
    roleCanExecuteControlPlaneActions(authQuery.data.role);

  return (
    <>
      <header className="page-header">
        <div>
          <h1 className="page-title">Agent playground</h1>
          <p className="page-subtitle">
            Run ad-hoc tests against immutable AgentVersions using the same Run
            lifecycle as production execution.
          </p>
        </div>
        <Link className="button button-secondary" to="/testing">
          Back to Testing Studio
        </Link>
      </header>

      <AgentPlaygroundPanel mode="standalone" canExecute={canExecute} />
    </>
  );
}
