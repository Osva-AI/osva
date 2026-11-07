import type { ModelProfileVersionId } from "@osva-ai/contracts";

import type {
  BuilderProposalNewAgentV1,
  BuilderProposalV1,
} from "@osva/domain/builder";

export function minimalNewAgent(
  ref: `bpr_${string}`,
): BuilderProposalNewAgentV1 {
  return {
    kind: "NEW",
    ref,
    agentKey: `key-${ref}`,
    agentName: `Name ${ref}`,
    instructions: "Do the task.",
    inputSchema: { type: "object" },
    outputSchema: { type: "object" },
    modelBindingName: "default",
    model: {
      bindingName: "default",
      modelProfileVersionId: "mpv-test" as ModelProfileVersionId,
    },
    tools: [],
    execution: {
      timeoutMs: 30_000,
      maxAttempts: 2,
      maxModelInvocations: 4,
      maxToolInvocations: 0,
    },
  };
}

export function baseProposal(
  overrides: Partial<BuilderProposalV1> = {},
): BuilderProposalV1 {
  const agent = minimalNewAgent("bpr_a");
  return {
    schemaVersion: "1",
    workflowRegistry: { key: "wf", name: "WF" },
    agents: [agent],
    workflow: {
      nodes: [{ key: "n1", type: "AGENT", agentRef: "bpr_a" }],
      edges: [],
    },
    assumptions: [],
    unresolvedRequirements: [],
    ...overrides,
  };
}

export function publicationBaseProposal(
  mpvId: ModelProfileVersionId,
): BuilderProposalV1 {
  return baseProposal({
    agents: [
      {
        ...minimalNewAgent("bpr_a"),
        model: { bindingName: "default", modelProfileVersionId: mpvId },
      },
    ],
  });
}
