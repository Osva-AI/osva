import type {
  ModelProfileId,
  ModelProfileVersionId,
  WorkspaceId,
} from "@osva-ai/contracts";
import type {
  BuilderProposalV1,
  WorkspaceBuilderCapabilityCatalogV1,
} from "@osva/domain/builder";

export const ANTHROPIC_REFINEMENT_WORKFLOW_KEY = "weekly-feedback-summary";
export const ANTHROPIC_REFINEMENT_WORKFLOW_NAME = "Weekly feedback summary";
export const ANTHROPIC_REFINEMENT_AGENT_REF = "bpr_summarizer" as const;
export const ANTHROPIC_REFINEMENT_AGENT_NODE_KEY = "summarize";
export const ANTHROPIC_REFINEMENT_AGENT_KEY = "weekly-summarizer";
export const ANTHROPIC_REFINEMENT_AGENT_NAME = "Weekly summarizer";
export const ANTHROPIC_REFINEMENT_SUMMARIZER_INSTRUCTIONS =
  "Summarize weekly product feedback. Identify recurring themes, highlight critical issues, and produce actionable recommendations.";
export const ANTHROPIC_REFINEMENT_APPROVAL_TITLE = "Review weekly summary";

/**
 * Isolated Anthropic refinement uses a verified canonical fixture instead of
 * a second live generation. The generation probe artifact is sanitized and
 * does not contain the proposal body, so it cannot be the refine baseline.
 */
export function anthropicRefinementInstruction(): string {
  return [
    "Add a human APPROVAL node immediately before the existing final AGENT node named summarize.",
    `The approval title must be ${ANTHROPIC_REFINEMENT_APPROVAL_TITLE}.`,
    "Keep the original summarizer agent, its instructions, its node key summarize, and the workflow registry key weekly-feedback-summary.",
    "Do not add tools or extra agents.",
    "Connect the new APPROVAL node so it precedes summarize and the graph remains a single valid path.",
    "Do not publish or execute anything.",
  ].join(" ");
}

export function anthropicRefinementBaseProposal(
  generationModelProfileVersionId: ModelProfileVersionId,
): BuilderProposalV1 {
  return {
    schemaVersion: "1",
    workflowRegistry: {
      key: ANTHROPIC_REFINEMENT_WORKFLOW_KEY,
      name: ANTHROPIC_REFINEMENT_WORKFLOW_NAME,
    },
    agents: [
      {
        kind: "NEW",
        ref: ANTHROPIC_REFINEMENT_AGENT_REF,
        agentKey: ANTHROPIC_REFINEMENT_AGENT_KEY,
        agentName: ANTHROPIC_REFINEMENT_AGENT_NAME,
        instructions: ANTHROPIC_REFINEMENT_SUMMARIZER_INSTRUCTIONS,
        inputSchema: { type: "object" },
        outputSchema: { type: "object" },
        modelBindingName: "default",
        model: {
          bindingName: "default",
          modelProfileVersionId: generationModelProfileVersionId,
        },
        tools: [],
        execution: {
          timeoutMs: 30_000,
          maxAttempts: 2,
          maxModelInvocations: 4,
          maxToolInvocations: 0,
        },
      },
    ],
    workflow: {
      nodes: [
        {
          key: ANTHROPIC_REFINEMENT_AGENT_NODE_KEY,
          type: "AGENT",
          agentRef: ANTHROPIC_REFINEMENT_AGENT_REF,
        },
      ],
      edges: [],
    },
    assumptions: [],
    unresolvedRequirements: [],
  };
}

export function expectedAnthropicApprovalRefinement(
  generationModelProfileVersionId: ModelProfileVersionId,
  approvalKey = "review_summary",
): BuilderProposalV1 {
  const base = anthropicRefinementBaseProposal(generationModelProfileVersionId);
  return {
    ...base,
    workflow: {
      nodes: [
        {
          key: approvalKey,
          type: "APPROVAL",
          title: ANTHROPIC_REFINEMENT_APPROVAL_TITLE,
        },
        ...base.workflow.nodes,
      ],
      edges: [{ from: approvalKey, to: ANTHROPIC_REFINEMENT_AGENT_NODE_KEY }],
    },
  };
}

export function anthropicRefinementScoringCatalog(
  workspaceId: WorkspaceId,
  generationModelProfileVersionId: ModelProfileVersionId,
): WorkspaceBuilderCapabilityCatalogV1 {
  return {
    workspaceId,
    agentVersions: [],
    modelProfileVersions: [
      {
        modelProfileVersionId: generationModelProfileVersionId,
        modelProfileId: "mp_anthropic_refine" as ModelProfileId,
        modelProfileKey: "default",
        modelProfileName: "default",
        version: 1,
        provider: "ANTHROPIC",
        model: "claude-sonnet-5-5",
      },
    ],
    toolVersions: [],
  };
}
