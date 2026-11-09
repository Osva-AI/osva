import type { ModelProfileVersionId } from "@osva-ai/contracts";

import type { ControlPlaneScope } from "../control-plane.js";

import type { BuilderIssueV1 } from "./builder-issue.js";
import type { BuilderProposalV1 } from "./builder-proposal.js";
import type {
  BuilderGenerationErrorCode,
  BuilderGenerationMetadataV1,
  BuilderGenerationProviderDiagnosticV1,
} from "./builder-natural-language-generation-types.js";
import type { BuilderProposalChangesetV1 } from "./compare-builder-proposal-changes.js";

/**
 * Version of the deterministic refinement system envelope (M20.5).
 * Bump when refinement instructions change materially.
 */
export const BUILDER_REFINEMENT_PROMPT_VERSION = "3" as const;

export type BuilderRefinementErrorCode =
  | BuilderGenerationErrorCode
  | "STALE_BASE_PROPOSAL_DIGEST"
  | "INVALID_BASE_PROPOSAL"
  | "CURRENT_PROPOSAL_TOO_LARGE";

export interface RefineBuilderProposalRequestV1 {
  readonly scope: ControlPlaneScope;
  /** Validated current draft (untrusted content; structurally validated server-side). */
  readonly currentProposal: unknown;
  /** Natural-language refinement instruction (untrusted). */
  readonly refinementInstruction: string;
  readonly generationModelProfileVersionId?: ModelProfileVersionId;
  /**
   * Client-expected digest of {@link currentProposal} after server parse+validation.
   * Mismatch returns {@link STALE_BASE_PROPOSAL_DIGEST} without model inference.
   */
  readonly expectedBaseProposalDigest: string;
  /**
   * Optional bounded UX-only history (short strings). Never overrides current proposal.
   */
  readonly conversationalHistory?: readonly string[];
}

export interface BuilderRefinementMetadataV1 extends BuilderGenerationMetadataV1 {
  readonly refinementPromptVersion: typeof BUILDER_REFINEMENT_PROMPT_VERSION;
  readonly baseProposalDigest: string;
  readonly candidateProposalDigest?: string;
  readonly noop: boolean;
}

export interface BuilderRefinementSuccessV1 {
  readonly ok: true;
  readonly baseProposalDigest: string;
  readonly candidateProposal: BuilderProposalV1;
  readonly candidateProposalDigest: string;
  readonly changes: BuilderProposalChangesetV1;
  readonly compileIssues: readonly BuilderIssueV1[];
  readonly previewLogicalWorkflowDigest?: string;
  readonly assumptions: readonly string[];
  readonly unresolvedRequirements: readonly string[];
  readonly metadata: BuilderRefinementMetadataV1;
}

export interface BuilderRefinementFailureV1 {
  readonly ok: false;
  readonly errorCode: BuilderRefinementErrorCode;
  readonly message: string;
  readonly baseProposalDigest?: string;
  readonly compileIssues?: readonly BuilderIssueV1[];
  readonly detailMessages?: readonly string[];
  readonly providerDiagnostic?: BuilderGenerationProviderDiagnosticV1;
  readonly metadata?: Partial<BuilderRefinementMetadataV1>;
}

export type RefineBuilderProposalResultV1 =
  BuilderRefinementSuccessV1 | BuilderRefinementFailureV1;

export interface BuilderRefinementLimitsV1 {
  readonly maxCatalogAgentVersions: number;
  readonly maxCatalogModelProfileVersions: number;
  readonly maxCatalogToolVersions: number;
  readonly maxCatalogSerializedUtf16Units: number;
  readonly maxRefinementInstructionUtf16Units: number;
  readonly maxCurrentProposalSerializedUtf16Units: number;
  readonly maxConversationalHistoryEntries: number;
  readonly maxConversationalHistoryUtf16Units: number;
  readonly maxTotalDurationMs: number;
  readonly maxOutputTokensPerAttempt: number;
  readonly maxProviderInvocations: number;
}

export const DEFAULT_BUILDER_REFINEMENT_LIMITS: BuilderRefinementLimitsV1 = {
  maxCatalogAgentVersions: 256,
  maxCatalogModelProfileVersions: 128,
  maxCatalogToolVersions: 256,
  maxCatalogSerializedUtf16Units: 48_000,
  maxRefinementInstructionUtf16Units: 16_384,
  maxCurrentProposalSerializedUtf16Units: 200_000,
  maxConversationalHistoryEntries: 8,
  maxConversationalHistoryUtf16Units: 4_096,
  maxTotalDurationMs: 120_000,
  maxOutputTokensPerAttempt: 4096,
  maxProviderInvocations: 2,
};
