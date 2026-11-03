import type { AgentResource } from "../hooks/use-agents";
import type { RunResource } from "../hooks/use-runs";
import type { WorkflowResource } from "../hooks/use-workflows";

export interface HomeResumeTarget {
  readonly kind: "workflow" | "agent";
  readonly name: string;
  readonly detail: string;
  readonly href: string;
  readonly primaryActionLabel: string;
}

function sortWorkflowsByRecent(
  workflows: readonly WorkflowResource[],
): readonly WorkflowResource[] {
  return [...workflows].sort(
    (a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt),
  );
}

export function selectHomeResumeTarget(input: {
  readonly agents: readonly AgentResource[];
  readonly workflows: readonly WorkflowResource[];
  readonly recentRuns: readonly RunResource[];
}): HomeResumeTarget | undefined {
  const recentWorkflow = sortWorkflowsByRecent(input.workflows)[0];
  if (recentWorkflow !== undefined) {
    return {
      kind: "workflow",
      name: recentWorkflow.name,
      detail: "Pick up your workflow where you left off.",
      href: `/workflows/${encodeURIComponent(recentWorkflow.id)}`,
      primaryActionLabel: "Continue workflow",
    };
  }

  const agentsById = new Map(input.agents.map((agent) => [agent.id, agent]));
  for (const run of input.recentRuns) {
    const agent = agentsById.get(run.agentId);
    if (agent !== undefined) {
      return {
        kind: "agent",
        name: agent.name,
        detail: "Based on your most recent agent activity.",
        href: `/agents/${encodeURIComponent(agent.id)}`,
        primaryActionLabel: "Open agent",
      };
    }
  }

  const fallbackAgent = input.agents[0];
  if (fallbackAgent !== undefined) {
    return {
      kind: "agent",
      name: fallbackAgent.name,
      detail: "Open this agent to keep building.",
      href: `/agents/${encodeURIComponent(fallbackAgent.id)}`,
      primaryActionLabel: "Open agent",
    };
  }

  return undefined;
}
