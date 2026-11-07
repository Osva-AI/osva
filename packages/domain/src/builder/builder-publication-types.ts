import type {
  AgentId,
  AgentVersionId,
  WorkflowId,
  WorkflowVersionId,
  WorkspaceId,
} from "@osva-ai/contracts";

import type { BuilderIssueV1 } from "./builder-issue.js";
import type {
  BuilderProposalAgentRef,
  BuilderProposalV1,
} from "./builder-proposal.js";

export const BUILDER_PUBLICATION_MODE_CREATE_V1 =
  "CREATE_NEW_WORKFLOW_V1" as const;
export type BuilderPublicationModeV1 =
  typeof BUILDER_PUBLICATION_MODE_CREATE_V1;

export type BuilderPublicationId = `bpub_${string}`;

export type BuilderPublicationStateV1 = "SUCCEEDED" | "FAILED";

export interface BuilderPublicationNewAgentSummaryV1 {
  readonly ref: BuilderProposalAgentRef;
  readonly agentKey: string;
  readonly agentName: string;
}

export interface BuilderPublicationReusedAgentSummaryV1 {
  readonly ref: BuilderProposalAgentRef;
  readonly agentVersionId: AgentVersionId;
  readonly agentKey: string;
  readonly agentName: string;
}

export interface BuilderPublicationPlanV1 {
  readonly planDigest: string;
  readonly publicationMode: BuilderPublicationModeV1;
  readonly workspaceId: WorkspaceId;
  readonly workflowRegistry: BuilderProposalV1["workflowRegistry"];
  readonly newAgents: readonly BuilderPublicationNewAgentSummaryV1[];
  readonly reusedAgents: readonly BuilderPublicationReusedAgentSummaryV1[];
  readonly previewLogicalWorkflowDigest: string | undefined;
  readonly assumptions: readonly string[];
  readonly unresolvedRequirements: readonly string[];
  readonly blockingIssues: readonly BuilderIssueV1[];
  readonly warnings: readonly BuilderIssueV1[];
  readonly publishable: boolean;
  readonly requiresUnresolvedAcknowledgement: boolean;
}

export interface BuilderPublicationRefResolutionV1 {
  readonly ref: BuilderProposalAgentRef;
  readonly agentVersionId: AgentVersionId;
}

export interface BuilderPublicationReceiptV1 {
  readonly id: BuilderPublicationId;
  readonly state: BuilderPublicationStateV1;
  readonly workspaceId: WorkspaceId;
  readonly planDigest: string;
  readonly workflowId: WorkflowId | undefined;
  readonly workflowVersionId: WorkflowVersionId | undefined;
  readonly newAgents: readonly {
    readonly agentId: AgentId;
    readonly agentVersionId: AgentVersionId;
    readonly ref: BuilderProposalAgentRef;
    readonly agentKey: string;
  }[];
  readonly reusedAgentVersionIds: readonly AgentVersionId[];
  readonly refResolution: readonly BuilderPublicationRefResolutionV1[];
  readonly publishedAt: string;
  readonly errorMessage?: string;
}

export interface BuilderPublicationPersistedResultV1 {
  readonly receipt: BuilderPublicationReceiptV1;
  readonly replay: boolean;
}
