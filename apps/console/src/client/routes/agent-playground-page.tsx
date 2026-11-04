import { Link } from "react-router-dom";

import { AgentPlaygroundPanel } from "../components/agent/agent-playground-panel";
import { TestingSectionNav } from "../components/testing/testing-section-nav";
import { PageHeader } from "../components/ui/page-header";
import { useAuthContextQuery } from "../hooks/use-auth-context";
import { describeTestingExecuteRoleRequirement } from "../lib/testing-resource-presentation";
import { roleCanExecuteControlPlaneActions } from "../lib/permissions";
import { useWorkspaceQueryScope } from "../hooks/use-workspace-query-scope";
import { LoadingBlock } from "../components/loading/loading-block";

export function AgentPlaygroundPage() {
  const workspaceId = useWorkspaceQueryScope();
  const authQuery = useAuthContextQuery();
  const canExecute =
    authQuery.data !== undefined &&
    roleCanExecuteControlPlaneActions(authQuery.data.role);

  if (workspaceId === undefined) {
    return <LoadingBlock label="Select a workspace to use the playground." />;
  }

  return (
    <div
      className="testing-v2 page-stack activity-v2"
      data-testid="testing-playground-page"
    >
      <PageHeader
        title="Agent playground"
        subtitle="Run ad-hoc tests against immutable agent versions using the same Run lifecycle as production."
        actions={
          <Link className="button button-secondary" to="/testing">
            Testing Studio
          </Link>
        }
      />
      <TestingSectionNav active="playground" canExecute={canExecute} />
      {authQuery.isSuccess && !canExecute ? (
        <section className="activity-v2-degraded" role="status">
          <p className="activity-v2-degraded-title">Execute access required</p>
          <p className="muted">{describeTestingExecuteRoleRequirement()}</p>
        </section>
      ) : null}
      <AgentPlaygroundPanel mode="standalone" canExecute={canExecute} />
    </div>
  );
}
