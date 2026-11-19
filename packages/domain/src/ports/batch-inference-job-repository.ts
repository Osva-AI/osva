import type {
  BatchInferenceEligibilityPolicy,
  BatchInferenceItemId,
  BatchInferenceItemStatus,
  BatchInferenceJobId,
  BatchInferenceJobStatus,
  BatchInferenceProviderJobStatus,
  GenerateCompletionInput,
  GenerateCompletionResult,
  ModelProfileVersionId,
  ModelProfileVersionPricing,
  ModelProvider,
  ModelProviderConnectionVersionId,
  ModelUsage,
  WorkspaceId,
} from "@osva-ai/contracts";

export interface BatchInferenceJobRecord {
  readonly id: BatchInferenceJobId;
  readonly workspaceId: WorkspaceId;
  readonly status: BatchInferenceJobStatus;
  readonly provider: ModelProvider;
  readonly providerBatchId?: string;
  readonly providerJobStatus?: BatchInferenceProviderJobStatus;
  readonly modelProfileVersionId: ModelProfileVersionId;
  readonly providerConnectionVersionId: ModelProviderConnectionVersionId;
  readonly providerModelId: string;
  readonly submissionFingerprint: string;
  readonly reconciliationRequired: boolean;
  readonly reconciliationNote?: string;
  readonly progressTotal: number;
  readonly progressPending: number;
  readonly progressProcessing: number;
  readonly progressSucceeded: number;
  readonly progressFailed: number;
  readonly progressCancelled: number;
  readonly progressExpired: number;
  readonly jobErrorCode?: string;
  readonly jobErrorMessage?: string;
  readonly estimatedCostMicros?: number;
  readonly pricingSnapshotId?: string;
  readonly pricingSnapshot?: ModelProfileVersionPricing;
  readonly requestMaterialHash: string;
  readonly usageFinalizedAt?: Date;
  readonly reconcileAfterAt?: Date;
  readonly completedAt?: Date;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface BatchInferenceItemRecord {
  readonly id: BatchInferenceItemId;
  readonly jobId: BatchInferenceJobId;
  readonly workspaceId: WorkspaceId;
  readonly providerCorrelationId: string;
  readonly status: BatchInferenceItemStatus;
  readonly input: GenerateCompletionInput;
  readonly result?: GenerateCompletionResult;
  readonly usage?: ModelUsage;
  readonly errorCode?: string;
  readonly errorMessage?: string;
  readonly estimatedCostMicros?: number;
}

export interface BatchInferenceJobProgressPatch {
  readonly status?: BatchInferenceJobStatus;
  readonly providerJobStatus?: BatchInferenceProviderJobStatus;
  readonly progressPending?: number;
  readonly progressProcessing?: number;
  readonly progressSucceeded?: number;
  readonly progressFailed?: number;
  readonly progressCancelled?: number;
  readonly progressExpired?: number;
  readonly jobErrorCode?: string;
  readonly jobErrorMessage?: string;
  readonly estimatedCostMicros?: number;
  readonly usageFinalizedAt?: Date;
  readonly completedAt?: Date;
  readonly reconcileAfterAt?: Date | null;
  readonly reconciliationRequired?: boolean;
  readonly reconciliationNote?: string | null;
}

export interface CreateBatchInferenceJobInput {
  readonly job: BatchInferenceJobRecord;
  readonly items: readonly BatchInferenceItemRecord[];
}

export interface BatchInferenceJobRepository {
  createJobWithItems(input: CreateBatchInferenceJobInput): Promise<void>;
  findJobById(
    workspaceId: WorkspaceId,
    jobId: BatchInferenceJobId,
  ): Promise<BatchInferenceJobRecord | null>;
  listJobs(
    workspaceId: WorkspaceId,
    options: { readonly limit: number; readonly cursor?: string },
  ): Promise<{
    readonly jobs: readonly BatchInferenceJobRecord[];
    readonly nextCursor?: string;
  }>;
  listItemsByJobId(
    workspaceId: WorkspaceId,
    jobId: BatchInferenceJobId,
    options: { readonly limit: number; readonly cursor?: string },
  ): Promise<{
    readonly items: readonly BatchInferenceItemRecord[];
    readonly nextCursor?: string;
  }>;
  claimSubmissionLease(
    jobId: BatchInferenceJobId,
    owner: string,
    expiresAt: Date,
  ): Promise<boolean>;
  markSubmitting(
    jobId: BatchInferenceJobId,
    fromStatus: BatchInferenceJobStatus,
  ): Promise<boolean>;
  markSubmitted(
    jobId: BatchInferenceJobId,
    input: {
      readonly providerBatchId: string;
      readonly providerJobStatus: BatchInferenceProviderJobStatus;
      readonly reconcileAfterAt: Date;
    },
  ): Promise<boolean>;
  markSubmissionAmbiguous(
    jobId: BatchInferenceJobId,
    note: string,
  ): Promise<void>;
  updateJobProgress(
    jobId: BatchInferenceJobId,
    patch: BatchInferenceJobProgressPatch,
  ): Promise<void>;

  requestCancellation(
    workspaceId: WorkspaceId,
    jobId: BatchInferenceJobId,
  ): Promise<boolean>;

  findJobByIdInternal(
    jobId: BatchInferenceJobId,
  ): Promise<BatchInferenceJobRecord | null>;

  listItemsForJob(
    jobId: BatchInferenceJobId,
  ): Promise<readonly BatchInferenceItemRecord[]>;
  updateItemOutcome(
    itemId: BatchInferenceItemId,
    patch: {
      readonly status: BatchInferenceItemStatus;
      readonly result?: GenerateCompletionResult;
      readonly usage?: ModelUsage;
      readonly errorCode?: string;
      readonly errorMessage?: string;
      readonly estimatedCostMicros?: number;
    },
  ): Promise<void>;
  findDueJobs(
    limit: number,
    now: Date,
  ): Promise<readonly BatchInferenceJobRecord[]>;
  findJobBySubmissionFingerprint(
    workspaceId: WorkspaceId,
    submissionFingerprint: string,
  ): Promise<BatchInferenceJobRecord | null>;
}

export interface WorkspaceBatchInferencePolicyRepository {
  findPolicyByWorkspaceId(
    workspaceId: WorkspaceId,
  ): Promise<BatchInferenceEligibilityPolicy | null>;
  upsertPolicy(
    workspaceId: WorkspaceId,
    policy: BatchInferenceEligibilityPolicy,
  ): Promise<void>;
}
