import type {
  BatchInferenceEligibilityPolicy,
  BatchInferenceItemId,
  BatchInferenceItemStatus,
  BatchInferenceJobId,
  GenerateCompletionResult,
  ModelUsage,
  WorkspaceId,
} from "@osva-ai/contracts";
import type {
  BatchInferenceItemRecord,
  BatchInferenceJobProgressPatch,
  BatchInferenceJobRecord,
  BatchInferenceJobRepository,
  CreateBatchInferenceJobInput,
  WorkspaceBatchInferencePolicyRepository,
} from "@osva/domain";

export class MemoryBatchInferenceJobRepository implements BatchInferenceJobRepository {
  private readonly jobs = new Map<string, BatchInferenceJobRecord>();
  private readonly items = new Map<string, BatchInferenceItemRecord[]>();

  async createJobWithItems(input: CreateBatchInferenceJobInput): Promise<void> {
    const job = {
      ...input.job,
      requestMaterialHash: input.job.requestMaterialHash ?? "",
    };
    this.jobs.set(input.job.id as string, job);
    this.items.set(
      input.job.id as string,
      input.items.map((item) => ({ ...item })),
    );
  }

  async findJobById(
    workspaceId: WorkspaceId,
    jobId: BatchInferenceJobId,
  ): Promise<BatchInferenceJobRecord | null> {
    const job = this.jobs.get(jobId as string);
    return job !== undefined && job.workspaceId === workspaceId ? job : null;
  }

  async listJobs(
    workspaceId: WorkspaceId,
    options: { readonly limit: number; readonly cursor?: string },
  ): Promise<{
    readonly jobs: readonly BatchInferenceJobRecord[];
    readonly nextCursor?: string;
  }> {
    const jobs = [...this.jobs.values()]
      .filter((job) => job.workspaceId === workspaceId)
      .filter(
        (job) =>
          options.cursor === undefined || (job.id as string) > options.cursor,
      )
      .sort((a, b) => (a.id as string).localeCompare(b.id as string))
      .slice(0, options.limit);
    return { jobs };
  }

  async listItemsByJobId(
    workspaceId: WorkspaceId,
    jobId: BatchInferenceJobId,
    options: { readonly limit: number; readonly cursor?: string },
  ): Promise<{
    readonly items: readonly BatchInferenceItemRecord[];
    readonly nextCursor?: string;
  }> {
    const job = await this.findJobById(workspaceId, jobId);
    if (job === null) {
      throw new Error("batch job not found");
    }
    const rows = this.items.get(jobId as string) ?? [];
    return { items: rows.slice(0, options.limit) };
  }

  async claimSubmissionLease(): Promise<boolean> {
    return false;
  }

  async markSubmitting(): Promise<boolean> {
    return false;
  }

  async markSubmitted(): Promise<boolean> {
    return true;
  }

  async markSubmissionAmbiguous(): Promise<void> {}

  async updateJobProgress(
    jobId: BatchInferenceJobId,
    patch: BatchInferenceJobProgressPatch,
  ): Promise<void> {
    const job = this.jobs.get(jobId as string);
    if (job === undefined) return;
    const updated: BatchInferenceJobRecord = {
      ...job,
      ...(patch.status !== undefined ? { status: patch.status } : {}),
      ...(patch.providerJobStatus !== undefined
        ? { providerJobStatus: patch.providerJobStatus }
        : {}),
      ...(patch.progressPending !== undefined
        ? { progressPending: patch.progressPending }
        : {}),
      ...(patch.progressProcessing !== undefined
        ? { progressProcessing: patch.progressProcessing }
        : {}),
      ...(patch.progressSucceeded !== undefined
        ? { progressSucceeded: patch.progressSucceeded }
        : {}),
      ...(patch.progressFailed !== undefined
        ? { progressFailed: patch.progressFailed }
        : {}),
      ...(patch.progressCancelled !== undefined
        ? { progressCancelled: patch.progressCancelled }
        : {}),
      ...(patch.progressExpired !== undefined
        ? { progressExpired: patch.progressExpired }
        : {}),
      ...(patch.jobErrorCode !== undefined
        ? { jobErrorCode: patch.jobErrorCode }
        : {}),
      ...(patch.jobErrorMessage !== undefined
        ? { jobErrorMessage: patch.jobErrorMessage }
        : {}),
      ...(patch.estimatedCostMicros !== undefined
        ? { estimatedCostMicros: patch.estimatedCostMicros }
        : {}),
      ...(patch.usageFinalizedAt !== undefined
        ? { usageFinalizedAt: patch.usageFinalizedAt }
        : {}),
      ...(patch.completedAt !== undefined
        ? { completedAt: patch.completedAt }
        : {}),
      ...(patch.reconcileAfterAt !== undefined
        ? patch.reconcileAfterAt === null
          ? { reconcileAfterAt: undefined }
          : { reconcileAfterAt: patch.reconcileAfterAt }
        : {}),
      ...(patch.reconciliationRequired !== undefined
        ? { reconciliationRequired: patch.reconciliationRequired }
        : {}),
      ...(patch.reconciliationNote !== undefined
        ? patch.reconciliationNote === null
          ? { reconciliationNote: undefined }
          : { reconciliationNote: patch.reconciliationNote }
        : {}),
      updatedAt: new Date(),
    };
    this.jobs.set(jobId as string, updated);
  }

  async requestCancellation(
    workspaceId: WorkspaceId,
    jobId: BatchInferenceJobId,
  ): Promise<boolean> {
    const job = await this.findJobById(workspaceId, jobId);
    if (job === null) return false;
    this.jobs.set(jobId as string, {
      ...job,
      status: "CANCELLING",
      updatedAt: new Date(),
    });
    return true;
  }

  async findJobByIdInternal(
    jobId: BatchInferenceJobId,
  ): Promise<BatchInferenceJobRecord | null> {
    return this.jobs.get(jobId as string) ?? null;
  }

  async listItemsForJob(
    jobId: BatchInferenceJobId,
  ): Promise<readonly BatchInferenceItemRecord[]> {
    return this.items.get(jobId as string) ?? [];
  }

  async updateItemOutcome(
    itemId: BatchInferenceItemId,
    patch: {
      readonly status: BatchInferenceItemStatus;
      readonly result?: GenerateCompletionResult;
      readonly usage?: ModelUsage;
      readonly errorCode?: string;
      readonly errorMessage?: string;
      readonly estimatedCostMicros?: number;
    },
  ): Promise<void> {
    for (const [jobId, rows] of this.items) {
      const index = rows.findIndex((row) => row.id === itemId);
      if (index >= 0) {
        rows[index] = { ...rows[index]!, ...patch };
        this.items.set(jobId, rows);
        return;
      }
    }
  }

  async findDueJobs(): Promise<readonly BatchInferenceJobRecord[]> {
    return [];
  }

  async findJobBySubmissionFingerprint(): Promise<BatchInferenceJobRecord | null> {
    return null;
  }
}

export class MemoryWorkspaceBatchInferencePolicyRepository implements WorkspaceBatchInferencePolicyRepository {
  private readonly policies = new Map<
    string,
    BatchInferenceEligibilityPolicy
  >();

  async findPolicyByWorkspaceId(
    workspaceId: WorkspaceId,
  ): Promise<BatchInferenceEligibilityPolicy | null> {
    return this.policies.get(workspaceId) ?? null;
  }

  async upsertPolicy(
    workspaceId: WorkspaceId,
    policy: BatchInferenceEligibilityPolicy,
  ): Promise<void> {
    this.policies.set(workspaceId, policy);
  }
}
