import type { AgentResource } from "../hooks/use-agents";
import type { RunResource } from "../hooks/use-runs";
import type { WorkflowResource } from "../hooks/use-workflows";
import type { AttentionItem } from "./overview-attention";
import type { HomeResumeTarget } from "./home-v2-resume";

export interface HomeSideResource {
  readonly kind: "agent" | "workflow";
  readonly name: string;
  readonly detail: string;
  readonly href: string;
  readonly linkLabel: string;
}

export interface HomeSideContext {
  readonly resource: HomeSideResource | undefined;
  readonly attentionItem: AttentionItem | undefined;
}

function sortWorkflowsByRecent(
  workflows: readonly WorkflowResource[],
): readonly WorkflowResource[] {
  return [...workflows].sort(
    (a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt),
  );
}

function pickAgentForSide(
  agents: readonly AgentResource[],
  recentRuns: readonly RunResource[],
  excludeAgentId: string | undefined,
): AgentResource | undefined {
  const agentsById = new Map(agents.map((agent) => [agent.id, agent]));
  for (const run of recentRuns) {
    if (excludeAgentId !== undefined && run.agentId === excludeAgentId) {
      continue;
    }
    const agent = agentsById.get(run.agentId);
    if (agent !== undefined) {
      return agent;
    }
  }
  return agents.find((agent) => agent.id !== excludeAgentId) ?? agents[0];
}

function pickWorkflowForSide(
  workflows: readonly WorkflowResource[],
  excludeWorkflowId: string | undefined,
): WorkflowResource | undefined {
  const sorted = sortWorkflowsByRecent(workflows);
  return (
    sorted.find((workflow) => workflow.id !== excludeWorkflowId) ?? sorted[0]
  );
}

function firstActionableAttention(
  items: readonly AttentionItem[],
): AttentionItem | undefined {
  return items.find(
    (item) =>
      item.attentionKind === "failed" || item.attentionKind === "waiting",
  );
}

export function selectHomeSideContext(input: {
  readonly resume: HomeResumeTarget | undefined;
  readonly agents: readonly AgentResource[];
  readonly workflows: readonly WorkflowResource[];
  readonly recentRuns: readonly RunResource[];
  readonly attentionItems: readonly AttentionItem[];
}): HomeSideContext {
  const attentionItem = firstActionableAttention(input.attentionItems);
  let resource: HomeSideResource | undefined;

  if (input.resume?.kind === "workflow") {
    const agent = pickAgentForSide(input.agents, input.recentRuns, undefined);
    if (agent !== undefined) {
      resource = {
        kind: "agent",
        name: agent.name,
        detail: "Open this agent to review instructions and recent runs.",
        href: `/agents/${encodeURIComponent(agent.id)}`,
        linkLabel: "Open agent",
      };
    }
  } else if (input.resume?.kind === "agent") {
    const workflow = pickWorkflowForSide(input.workflows, undefined);
    if (workflow !== undefined) {
      resource = {
        kind: "workflow",
        name: workflow.name,
        detail: "Continue designing or running this workflow.",
        href: `/workflows/${encodeURIComponent(workflow.id)}`,
        linkLabel: "Open workflow",
      };
    }
  } else {
    const workflow = pickWorkflowForSide(input.workflows, undefined);
    const agent = pickAgentForSide(input.agents, input.recentRuns, undefined);
    if (workflow !== undefined) {
      resource = {
        kind: "workflow",
        name: workflow.name,
        detail: "Open this workflow to keep building.",
        href: `/workflows/${encodeURIComponent(workflow.id)}`,
        linkLabel: "Open workflow",
      };
    } else if (agent !== undefined) {
      resource = {
        kind: "agent",
        name: agent.name,
        detail: "Open this agent to keep building.",
        href: `/agents/${encodeURIComponent(agent.id)}`,
        linkLabel: "Open agent",
      };
    }
  }

  return { resource, attentionItem };
}

export function shouldUseReturningGrid(input: {
  readonly resume: HomeResumeTarget | undefined;
  readonly side: HomeSideContext;
}): boolean {
  if (input.resume !== undefined) {
    return (
      input.side.resource !== undefined ||
      input.side.attentionItem !== undefined
    );
  }
  return false;
}
