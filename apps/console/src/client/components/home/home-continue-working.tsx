import { Link } from "react-router-dom";

import type { AgentResource } from "../../hooks/use-agents";
import type { RunResource } from "../../hooks/use-runs";
import type { WorkflowResource } from "../../hooks/use-workflows";
import { SectionPanel } from "../ui/section-panel";

function sortWorkflowsByRecent(
  workflows: readonly WorkflowResource[],
): readonly WorkflowResource[] {
  return [...workflows].sort((a, b) => {
    const aTime = Date.parse(a.updatedAt);
    const bTime = Date.parse(b.updatedAt);
    return bTime - aTime;
  });
}

function recentAgentIdsFromRuns(
  runs: readonly RunResource[],
  limit: number,
): readonly string[] {
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const run of runs) {
    if (seen.has(run.agentId)) {
      continue;
    }
    seen.add(run.agentId);
    ids.push(run.agentId);
    if (ids.length >= limit) {
      break;
    }
  }
  return ids;
}

export function HomeContinueWorking({
  agents,
  workflows,
  recentRuns,
}: {
  readonly agents: readonly AgentResource[];
  readonly workflows: readonly WorkflowResource[];
  readonly recentRuns: readonly RunResource[];
}) {
  const recentWorkflows = sortWorkflowsByRecent(workflows).slice(0, 4);
  const recentAgentIds = recentAgentIdsFromRuns(recentRuns, 4);
  const agentsById = new Map(agents.map((agent) => [agent.id, agent]));

  const hasWorkflows = recentWorkflows.length > 0;
  const hasAgents =
    recentAgentIds.length > 0 ||
    (recentAgentIds.length === 0 && agents.length > 0);

  if (!hasWorkflows && !hasAgents) {
    return null;
  }

  return (
    <SectionPanel
      title="Continue working"
      description="Recently updated workflows when available. Agent activity is inferred from recent runs—not edit timestamps."
    >
      <div className="home-continue-grid">
        {hasWorkflows ? (
          <div>
            <h3 className="home-continue-heading">Workflows</h3>
            <ul className="home-continue-list">
              {recentWorkflows.map((workflow) => (
                <li key={workflow.id}>
                  <Link to={`/workflows/${encodeURIComponent(workflow.id)}`}>
                    {workflow.name}
                  </Link>
                  <span className="muted mono home-activity-secondary">
                    {workflow.key}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {hasAgents ? (
          <div>
            <h3 className="home-continue-heading">Agents</h3>
            <ul className="home-continue-list">
              {(recentAgentIds.length > 0
                ? recentAgentIds
                : agents.slice(0, 4).map((agent) => agent.id)
              ).map((agentId) => {
                const agent = agentsById.get(agentId);
                return (
                  <li key={agentId}>
                    <Link to={`/agents/${encodeURIComponent(agentId)}`}>
                      {agent?.name ?? agentId}
                    </Link>
                    {agent !== undefined ? (
                      <span className="muted mono home-activity-secondary">
                        {agent.key}
                      </span>
                    ) : (
                      <span className="muted mono home-activity-secondary">
                        Recent run activity
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}
      </div>
    </SectionPanel>
  );
}
