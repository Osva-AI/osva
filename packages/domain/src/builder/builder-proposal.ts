import type { JsonSchemaRecord } from "@osva-ai/contracts";
import type {
  AgentVersionId,
  ModelProfileVersionId,
  ToolVersionId,
  WorkflowBranchEqualsValue,
} from "@osva-ai/contracts";
import type {
  WorkflowDefinitionEdgeV3,
  WorkflowDefinitionBranchNodeV2,
  WorkflowDefinitionParallelNodeV2,
  WorkflowDefinitionJoinNodeV2,
  WorkflowDefinitionApprovalNodeV2,
  WorkflowDefinitionWaitConfigurationV3,
} from "@osva-ai/contracts";

/** Internal M20.1 builder proposal schema version (not a published HTTP contract). */
export const BUILDER_PROPOSAL_SCHEMA_VERSION = "1" as const;
export type BuilderProposalSchemaVersion =
  typeof BUILDER_PROPOSAL_SCHEMA_VERSION;

/**
 * Stable temporary reference for an agent within a proposal (editor scope).
 * Must not be fabricated as an {@link AgentVersionId}; publication maps refs to real IDs.
 */
export type BuilderProposalAgentRef = `bpr_${string}`;

export const BUILDER_PROPOSAL_AGENT_REF_PREFIX = "bpr_" as const;

export interface BuilderProposalWorkflowRegistryV1 {
  readonly key: string;
  readonly name: string;
  readonly description?: string;
}

export interface BuilderProposalNewAgentModelSelectionV1 {
  readonly bindingName: string;
  readonly modelProfileVersionId: ModelProfileVersionId;
}

export interface BuilderProposalNewAgentToolSelectionV1 {
  readonly bindingName: string;
  readonly toolVersionId: ToolVersionId;
}

export interface BuilderProposalNewAgentExecutionV1 {
  readonly timeoutMs: number;
  readonly maxAttempts: number;
  readonly maxModelInvocations: number;
  readonly maxToolInvocations: number;
  readonly maxOutputTokens?: number;
  readonly checkpointingEnabled?: boolean;
  readonly automaticRecoveryEnabled?: boolean;
}

/**
 * Proposed declarative agent (pre-publication). Compiles to {@link AgentManifestV1} with
 * `runtime.type === "DECLARATIVE"`.
 */
export interface BuilderProposalNewAgentV1 {
  readonly kind: "NEW";
  readonly ref: BuilderProposalAgentRef;
  readonly agentKey: string;
  readonly agentName: string;
  readonly instructions: string;
  readonly inputSchema: JsonSchemaRecord;
  readonly outputSchema: JsonSchemaRecord;
  /** Logical model binding name declared on the compiled manifest (default binding: `default`). */
  readonly modelBindingName: string;
  readonly model: BuilderProposalNewAgentModelSelectionV1;
  readonly tools: readonly BuilderProposalNewAgentToolSelectionV1[];
  readonly execution: BuilderProposalNewAgentExecutionV1;
}

/** Use an already-published immutable AgentVersion from the workspace catalog. */
export interface BuilderProposalExistingAgentV1 {
  readonly kind: "EXISTING";
  readonly ref: BuilderProposalAgentRef;
  readonly agentVersionId: AgentVersionId;
}

export type BuilderProposalAgentSpecV1 =
  BuilderProposalNewAgentV1 | BuilderProposalExistingAgentV1;

export interface BuilderProposalAgentNodeIntentV1 {
  readonly key: string;
  readonly type: "AGENT";
  readonly agentRef: BuilderProposalAgentRef;
}

export type BuilderProposalWorkflowNodeIntentV1 =
  | BuilderProposalAgentNodeIntentV1
  | WorkflowDefinitionBranchNodeV2
  | WorkflowDefinitionParallelNodeV2
  | WorkflowDefinitionJoinNodeV2
  | WorkflowDefinitionApprovalNodeV2
  | {
      readonly key: string;
      readonly type: "WAIT";
      readonly wait: WorkflowDefinitionWaitConfigurationV3;
    };

export interface BuilderProposalWorkflowIntentV1 {
  readonly nodes: readonly BuilderProposalWorkflowNodeIntentV1[];
  readonly edges: readonly WorkflowDefinitionEdgeV3[];
}

/**
 * Internal representation validated before compilation. Workspace identity is enforced only
 * via catalog + caller scope, never embedded as trusted data inside this document.
 */
export interface BuilderProposalV1 {
  readonly schemaVersion: BuilderProposalSchemaVersion;
  readonly workflowRegistry: BuilderProposalWorkflowRegistryV1;
  readonly agents: readonly BuilderProposalAgentSpecV1[];
  readonly workflow: BuilderProposalWorkflowIntentV1;
  readonly assumptions: readonly string[];
  readonly unresolvedRequirements: readonly string[];
}

/** Branch case value allowed in proposals (matches workflow contract). */
export type BuilderProposalBranchEqualsValue = WorkflowBranchEqualsValue;
