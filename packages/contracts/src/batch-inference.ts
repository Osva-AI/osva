import type {
  BatchInferenceItemId,
  BatchInferenceJobId,
  ModelProfileVersionId,
  ModelProviderConnectionVersionId,
  WorkspaceId,
} from "./ids.js";
import type {
  GenerateCompletionInput,
  GenerateCompletionResult,
  ModelErrorCode,
  ModelProvider,
  ModelUsage,
} from "./model-gateway.js";

/**
 * Portable provider-native batch inference contract. Bump when breaking shape
 * changes occur.
 */
export const BATCH_INFERENCE_CONTRACT_FORMAT_VERSION = "1" as const;

export type BatchInferenceContractFormatVersion =
  typeof BATCH_INFERENCE_CONTRACT_FORMAT_VERSION;

/** Max items in one OSVA batch job (enforced at submission). */
export const BATCH_INFERENCE_MAX_ITEM_COUNT = 50_000;

/** Max UTF-8 bytes for a single serialized item body submitted to providers. */
export const BATCH_INFERENCE_MAX_ITEM_PAYLOAD_BYTES = 1_048_576;

/**
 * Provider correlation id length cap for {@link BatchInferenceProviderCorrelationId}.
 * OpenAI/Anthropic custom_id limits are below this; Gemini keys are provider-defined.
 */
export const BATCH_INFERENCE_PROVIDER_CORRELATION_ID_MAX_LENGTH = 512;

export const BATCH_INFERENCE_JOB_STATUSES = [
  "CREATED",
  "SUBMITTING",
  "SUBMITTED",
  "PROCESSING",
  "FINALIZING",
  "COMPLETED",
  "PARTIALLY_COMPLETED",
  "FAILED",
  "CANCELLING",
  "CANCELLED",
  "EXPIRED",
] as const;

export type BatchInferenceJobStatus =
  (typeof BATCH_INFERENCE_JOB_STATUSES)[number];

/**
 * Normalized provider-reported batch lifecycle. Distinct from OSVA
 * {@link BatchInferenceJobStatus}.
 */
export const BATCH_INFERENCE_PROVIDER_JOB_STATUSES = [
  "UNKNOWN",
  "VALIDATING",
  "IN_PROGRESS",
  "COMPLETED",
  "FAILED",
  "CANCELLING",
  "CANCELLED",
  "EXPIRED",
] as const;

export type BatchInferenceProviderJobStatus =
  (typeof BATCH_INFERENCE_PROVIDER_JOB_STATUSES)[number];

export const BATCH_INFERENCE_ITEM_STATUSES = [
  "PENDING",
  "SUBMITTED",
  "PROCESSING",
  "SUCCEEDED",
  "FAILED",
  "CANCELLED",
  "EXPIRED",
  "UNKNOWN",
] as const;

export type BatchInferenceItemStatus =
  (typeof BATCH_INFERENCE_ITEM_STATUSES)[number];

export const BATCH_INFERENCE_EXECUTION_MODES = [
  "PROVIDER_NATIVE_ASYNC",
] as const;

export type BatchInferenceExecutionMode =
  (typeof BATCH_INFERENCE_EXECUTION_MODES)[number];

export type BatchInferenceProviderCorrelationId = string;

export type BatchInferenceProviderBatchId = string;

export type BatchInferenceSubmissionFingerprint = string;

export interface BatchInferenceProgressCounts {
  readonly total: number;
  readonly pending: number;
  readonly processing: number;
  readonly succeeded: number;
  readonly failed: number;
  readonly cancelled: number;
  readonly expired: number;
}

export interface BatchInferenceItemError {
  readonly code: ModelErrorCode | "BATCH_ITEM_PROVIDER_ERROR";
  readonly message: string;
  readonly retryable?: boolean;
  readonly providerErrorCode?: string;
}

export interface BatchInferenceJobError {
  readonly code:
    | ModelErrorCode
    | "BATCH_JOB_PROVIDER_ERROR"
    | "BATCH_JOB_RECONCILIATION_ERROR"
    | "BATCH_JOB_UNSUPPORTED_CAPABILITY"
    | "BATCH_JOB_POLICY_DENIED";
  readonly message: string;
  readonly retryable?: boolean;
}

export interface BatchInferenceItemRequest {
  /** Stable OSVA item identity for the life of the job. */
  readonly itemId: BatchInferenceItemId;
  /**
   * Opaque provider correlation key (e.g. OpenAI/Anthropic custom_id). Must be
   * unique within the job.
   */
  readonly providerCorrelationId: BatchInferenceProviderCorrelationId;
  readonly input: GenerateCompletionInput;
}

export interface BatchInferenceCreateJobRequest {
  readonly formatVersion: BatchInferenceContractFormatVersion;
  readonly workspaceId: WorkspaceId;
  readonly jobId: BatchInferenceJobId;
  /** Immutable model binding for all items. */
  readonly modelProfileVersionId: ModelProfileVersionId;
  readonly providerConnectionVersionId: ModelProviderConnectionVersionId;
  readonly items: readonly BatchInferenceItemRequest[];
  /**
   * Idempotency fingerprint for durable submission (B3.4). Must be stable across
   * retries of the same logical submit; distinct jobs must use distinct values.
   */
  readonly submissionFingerprint: BatchInferenceSubmissionFingerprint;
  readonly executionMode: BatchInferenceExecutionMode;
  readonly metadata?: Readonly<Record<string, string>>;
}

export interface BatchInferenceJobIdentity {
  readonly formatVersion: BatchInferenceContractFormatVersion;
  readonly workspaceId: WorkspaceId;
  readonly jobId: BatchInferenceJobId;
  readonly modelProfileVersionId: ModelProfileVersionId;
  readonly providerConnectionVersionId: ModelProviderConnectionVersionId;
  readonly submissionFingerprint: BatchInferenceSubmissionFingerprint;
}

export interface BatchInferenceProviderIdentity {
  readonly provider: ModelProvider;
  readonly providerBatchId: BatchInferenceProviderBatchId;
  readonly providerJobStatus?: BatchInferenceProviderJobStatus;
}

export interface BatchInferenceItemOutcome {
  readonly itemId: BatchInferenceItemId;
  readonly providerCorrelationId: BatchInferenceProviderCorrelationId;
  readonly status: BatchInferenceItemStatus;
  readonly result?: GenerateCompletionResult;
  readonly usage?: ModelUsage;
  readonly error?: BatchInferenceItemError;
  readonly providerRequestId?: string;
}

export interface BatchInferenceJobOutcome {
  readonly identity: BatchInferenceJobIdentity;
  readonly status: BatchInferenceJobStatus;
  readonly progress: BatchInferenceProgressCounts;
  readonly provider?: BatchInferenceProviderIdentity;
  readonly itemOutcomes?: readonly BatchInferenceItemOutcome[];
  readonly jobError?: BatchInferenceJobError;
  readonly batchUsage?: ModelUsage;
  readonly estimatedCost?: number;
  readonly pricingSnapshotId?: string;
  readonly completedAt?: string;
  readonly expiresAt?: string;
}

export interface BatchInferenceReconciliationReport {
  readonly expectedCount: number;
  readonly receivedCount: number;
  readonly matchedCount: number;
  readonly missingItemIds: readonly BatchInferenceItemId[];
  readonly duplicateItemIds: readonly BatchInferenceItemId[];
  readonly unexpectedItemIds: readonly BatchInferenceItemId[];
  readonly isComplete: boolean;
}

export interface BatchInferenceCancelRequest {
  readonly formatVersion: BatchInferenceContractFormatVersion;
  readonly workspaceId: WorkspaceId;
  readonly jobId: BatchInferenceJobId;
  readonly reason?: string;
}

export interface BatchInferenceEligibilityPolicy {
  /** Default OFF until workspace policy explicitly enables batch inference. */
  readonly batchInferenceEnabled: boolean;
  readonly allowedProviders?: readonly ModelProvider[];
  readonly maxItemCount?: number;
  readonly denySensitiveWorkloads?: boolean;
}

export function createDefaultBatchInferenceEligibilityPolicy(): BatchInferenceEligibilityPolicy {
  return {
    batchInferenceEnabled: false,
    denySensitiveWorkloads: true,
    maxItemCount: BATCH_INFERENCE_MAX_ITEM_COUNT,
  };
}

export interface BatchInferenceProviderCapabilityFlags {
  readonly supportsNativeBatch: boolean;
  readonly supportsJsonlFileUpload: boolean;
  readonly supportsInlineBatch: boolean;
  readonly supportsCancel: boolean;
  readonly supportsListBatches: boolean;
  readonly supportsPerItemUsage: boolean;
  readonly supportsBatchLevelUsage: boolean;
  readonly supportsCachedInputAccounting: boolean;
  readonly correlationIdField: "custom_id" | "provider_defined" | "none";
  readonly supportsArbitraryIdempotencyKey: boolean;
  readonly typicalDiscountNote?: string;
  readonly unsupportedCapabilities: readonly string[];
  readonly dataRetentionNote?: string;
}

/**
 * Documented capability matrix for B3.1 (no live provider calls). Update when
 * adapters implement B3.2+.
 */
export const BATCH_INFERENCE_PROVIDER_CAPABILITIES: Readonly<
  Record<ModelProvider, BatchInferenceProviderCapabilityFlags>
> = {
  OPENAI: {
    supportsNativeBatch: true,
    supportsJsonlFileUpload: true,
    supportsInlineBatch: false,
    supportsCancel: true,
    supportsListBatches: true,
    supportsPerItemUsage: true,
    supportsBatchLevelUsage: true,
    supportsCachedInputAccounting: true,
    correlationIdField: "custom_id",
    supportsArbitraryIdempotencyKey: false,
    typicalDiscountNote: "Batch API pricing tier; model-specific.",
    unsupportedCapabilities: ["inline_batch_requests"],
    dataRetentionNote: "Input/output files retained per OpenAI batch policy.",
  },
  ANTHROPIC: {
    supportsNativeBatch: true,
    supportsJsonlFileUpload: false,
    supportsInlineBatch: true,
    supportsCancel: true,
    supportsListBatches: true,
    supportsPerItemUsage: true,
    supportsBatchLevelUsage: false,
    supportsCachedInputAccounting: false,
    correlationIdField: "custom_id",
    supportsArbitraryIdempotencyKey: false,
    typicalDiscountNote: "Message Batches discount tier; model-specific.",
    unsupportedCapabilities: ["jsonl_file_upload_via_osva_abstraction"],
    dataRetentionNote:
      "Results available for download per Anthropic batch TTL.",
  },
  GOOGLE_GEMINI: {
    supportsNativeBatch: true,
    supportsJsonlFileUpload: true,
    supportsInlineBatch: true,
    supportsCancel: true,
    supportsListBatches: true,
    supportsPerItemUsage: false,
    supportsBatchLevelUsage: true,
    supportsCachedInputAccounting: false,
    correlationIdField: "provider_defined",
    supportsArbitraryIdempotencyKey: false,
    typicalDiscountNote:
      "Batch pricing varies by model; no universal discount.",
    unsupportedCapabilities: [
      "anthropic_style_custom_id",
      "openai_identical_correlation_semantics",
    ],
    dataRetentionNote:
      "File-backed batches follow Google Cloud file retention.",
  },
};

export interface BatchInferenceUsageAccountingLine {
  readonly itemId?: BatchInferenceItemId;
  readonly usage?: ModelUsage;
  readonly estimatedCost?: number;
  /** When true, charges are provider-reported rather than OSVA-estimated. */
  readonly providerReported: boolean;
}

export interface BatchInferenceUsageAccountingSnapshot {
  readonly jobId: BatchInferenceJobId;
  readonly lines: readonly BatchInferenceUsageAccountingLine[];
  readonly batchLevelUsage?: ModelUsage;
  readonly batchLevelEstimatedCost?: number;
  readonly pricingSnapshotId?: string;
}
