import type {
  GenerateCompletionRequest,
  GenerateCompletionResult,
  ModelFinishReason,
  ModelProfileVersionId,
  ModelProvider,
} from "@osva-ai/contracts";

import type { BuilderGenerationAttemptDiagnosticV1 } from "./builder-generation-attempt-diagnostics.js";
import type { BuilderGenerationProviderDiagnosticV1 } from "./builder-model-gateway-diagnostics.js";

import type { ControlPlaneScope } from "../control-plane.js";

import type { BuilderIssueV1 } from "./builder-issue.js";
import type { BuilderProposalV1 } from "./builder-proposal.js";

/**
 * Version of the deterministic system + user envelope for NL builder generation (M20.2).
 * Bump when generation instructions change materially.
 */
export const BUILDER_GENERATION_PROMPT_VERSION = "3" as const;

/** High-level failure categories for NL generation (distinct from {@link BuilderIssueV1} compiler codes). */
export type BuilderGenerationErrorCode =
  | "INVALID_GENERATION_REQUEST"
  | "UNAUTHORIZED_GENERATION_MODEL"
  | "CATALOG_RETRIEVAL_FAILED"
  | "CATALOG_TOO_LARGE"
  | "PROMPT_TOO_LARGE"
  | "PROVIDER_UNAVAILABLE"
  | "PROVIDER_TIMEOUT"
  | "PROVIDER_ERROR"
  | "TOKEN_OR_OUTPUT_BUDGET_EXCEEDED"
  | "UNSUPPORTED_STRUCTURED_OUTPUT"
  | "INVALID_JSON_OUTPUT"
  | "INVALID_BUILDER_PROPOSAL"
  | "UNAUTHORIZED_OR_UNKNOWN_RESOURCE_REFERENCE"
  | "INVALID_COMPILED_PROPOSAL"
  | "GENERATION_DEADLINE_EXCEEDED"
  | "CATALOG_PROMPT_VISIBILITY_VIOLATION";

export interface BuilderGenerationPreferencesV1 {
  /**
   * Optional hint: model profile version IDs preferred for **execution** inside NEW agents
   * in the generated proposal. Must be authorized in the workspace catalog when used.
   * Does not select the generation model.
   */
  readonly preferredExecutionModelProfileVersionIds?: readonly ModelProfileVersionId[];
}

export interface GenerateBuilderProposalRequestV1 {
  readonly scope: ControlPlaneScope;
  /** Natural-language instructions (untrusted data). */
  readonly userInstruction: string;
  /**
   * Model profile version used only to **generate** the proposal via ModelGateway.
   * When omitted, {@link GenerateBuilderProposalFromNaturalLanguageDependencies.defaultGenerationModelProfileVersionId} must be set.
   */
  readonly generationModelProfileVersionId?: ModelProfileVersionId;
  readonly preferences?: BuilderGenerationPreferencesV1;
}

/** Aggregated provider token usage across builder generation/refinement attempts (M20.6). */
export interface BuilderGenerationMeasuredUsageV1 {
  readonly inputUnits: number;
  readonly outputUnits: number;
  readonly cachedUnits?: number;
  readonly usageMeasured: boolean;
}

export interface BuilderGenerationMetadataV1 {
  readonly promptVersion: typeof BUILDER_GENERATION_PROMPT_VERSION;
  readonly generationModelProfileVersionId: ModelProfileVersionId;
  readonly generationProvider: ModelProvider;
  readonly structuredOutputMode:
    "provider_json_schema" | "downstream_validation_only";
  readonly modelFinishReason?: ModelFinishReason;
  readonly providerFinishReason?: string;
  readonly attempts: number;
  readonly elapsedMs: number;
  readonly catalogAgentVersions: number;
  readonly catalogModelProfileVersions: number;
  readonly catalogToolVersions: number;
  readonly catalogTruncated: boolean;
  readonly measuredUsage?: BuilderGenerationMeasuredUsageV1;
  readonly attemptDiagnostics?: readonly BuilderGenerationAttemptDiagnosticV1[];
}

export interface BuilderGenerationSuccessV1 {
  readonly ok: true;
  readonly proposal: BuilderProposalV1;
  readonly compileIssues: readonly BuilderIssueV1[];
  readonly previewLogicalWorkflowDigest?: string;
  readonly assumptions: readonly string[];
  readonly unresolvedRequirements: readonly string[];
  readonly metadata: BuilderGenerationMetadataV1;
}

export interface BuilderGenerationFailureV1 {
  readonly ok: false;
  readonly errorCode: BuilderGenerationErrorCode;
  readonly message: string;
  readonly compileIssues?: readonly BuilderIssueV1[];
  /** Safe, compact parse/validation messages — not raw provider payloads. */
  readonly detailMessages?: readonly string[];
  /** Sanitized model-provider taxonomy (no prompts, bodies, or credentials). */
  readonly providerDiagnostic?: BuilderGenerationProviderDiagnosticV1;
  readonly metadata?: Partial<BuilderGenerationMetadataV1>;
}

export type { BuilderGenerationProviderDiagnosticV1 } from "./builder-model-gateway-diagnostics.js";

export type GenerateBuilderProposalResultV1 =
  BuilderGenerationSuccessV1 | BuilderGenerationFailureV1;

export interface BuilderGenerationLimitsV1 {
  readonly maxCatalogAgentVersions: number;
  readonly maxCatalogModelProfileVersions: number;
  readonly maxCatalogToolVersions: number;
  readonly maxCatalogSerializedUtf16Units: number;
  readonly maxUserInstructionUtf16Units: number;
  /** Total wall-clock budget for the operation (catalog + model calls). */
  readonly maxTotalDurationMs: number;
  /** Per-attempt max output tokens passed to ModelGateway. */
  readonly maxOutputTokensPerAttempt: number;
  /** Maximum provider invocations including one optional repair attempt. */
  readonly maxProviderInvocations: number;
}

export const DEFAULT_BUILDER_GENERATION_LIMITS: BuilderGenerationLimitsV1 = {
  maxCatalogAgentVersions: 256,
  maxCatalogModelProfileVersions: 128,
  maxCatalogToolVersions: 256,
  maxCatalogSerializedUtf16Units: 48_000,
  maxUserInstructionUtf16Units: 16_384,
  maxTotalDurationMs: 120_000,
  maxOutputTokensPerAttempt: 4096,
  maxProviderInvocations: 2,
};

/**
 * Model gateway port for builder generation — optional AbortSignal is supported by
 * {@link @osva/model-gateway} without widening the public contracts package.
 */
export interface BuilderGenerationModelGatewayPort {
  generateCompletion(
    request: GenerateCompletionRequest,
    options?: { readonly signal?: AbortSignal },
  ): Promise<GenerateCompletionResult>;
}
