import type {
  BatchInferenceEligibilityPolicy,
  BatchInferenceItemId,
  BatchInferenceJobId,
  BatchInferenceJobStatus,
  BatchInferenceProviderJobStatus,
  GenerateCompletionInput,
  WorkspaceId,
} from "@osva-ai/contracts";
import { createDefaultBatchInferenceEligibilityPolicy } from "@osva-ai/contracts";
import type {
  BatchInferenceJobProgressPatch,
  BatchInferenceJobRecord,
  BatchInferenceJobRepository,
  BatchInferenceItemRecord,
  CreateBatchInferenceJobInput,
  WorkspaceBatchInferencePolicyRepository,
} from "@osva/domain";
import {
  and,
  asc,
  eq,
  gt,
  inArray,
  isNotNull,
  isNull,
  lte,
  or,
  sql,
} from "drizzle-orm";

import type { Database } from "../database.js";
import { mapDatabaseError } from "../postgres-errors.js";
import { batchInferenceItems } from "../schema/batch-inference-items.js";
import { batchInferenceJobs } from "../schema/batch-inference-jobs.js";
import { workspaceBatchInferencePolicies } from "../schema/workspace-batch-inference-policies.js";

const NONTERMINAL = [
  "CREATED",
  "SUBMITTING",
  "SUBMITTED",
  "PROCESSING",
  "FINALIZING",
  "CANCELLING",
] as const;

function rowToJob(
  row: typeof batchInferenceJobs.$inferSelect,
): BatchInferenceJobRecord {
  return {
    id: row.id as BatchInferenceJobId,
    workspaceId: row.workspaceId as WorkspaceId,
    status: row.status as BatchInferenceJobStatus,
    provider: row.provider as BatchInferenceJobRecord["provider"],
    providerBatchId: row.providerBatchId ?? undefined,
    providerJobStatus: row.providerJobStatus as
      BatchInferenceProviderJobStatus | undefined,
    modelProfileVersionId:
      row.modelProfileVersionId as BatchInferenceJobRecord["modelProfileVersionId"],
    providerConnectionVersionId:
      row.providerConnectionVersionId as BatchInferenceJobRecord["providerConnectionVersionId"],
    providerModelId: row.providerModelId,
    submissionFingerprint: row.submissionFingerprint,
    reconciliationRequired: row.reconciliationRequired,
    reconciliationNote: row.reconciliationNote ?? undefined,
    progressTotal: row.progressTotal,
    progressPending: row.progressPending,
    progressProcessing: row.progressProcessing,
    progressSucceeded: row.progressSucceeded,
    progressFailed: row.progressFailed,
    progressCancelled: row.progressCancelled,
    progressExpired: row.progressExpired,
    jobErrorCode: row.jobErrorCode ?? undefined,
    jobErrorMessage: row.jobErrorMessage ?? undefined,
    estimatedCostMicros: row.estimatedCostMicros ?? undefined,
    pricingSnapshotId: row.pricingSnapshotId ?? undefined,
    pricingSnapshot:
      row.pricingSnapshotJson === null || row.pricingSnapshotJson === undefined
        ? undefined
        : (row.pricingSnapshotJson as BatchInferenceJobRecord["pricingSnapshot"]),
    requestMaterialHash: row.requestMaterialHash,
    usageFinalizedAt: row.usageFinalizedAt ?? undefined,
    reconcileAfterAt: row.reconcileAfterAt ?? undefined,
    completedAt: row.completedAt ?? undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function rowToItem(
  row: typeof batchInferenceItems.$inferSelect,
): BatchInferenceItemRecord {
  return {
    id: row.id as BatchInferenceItemId,
    jobId: row.jobId as BatchInferenceJobId,
    workspaceId: row.workspaceId as WorkspaceId,
    providerCorrelationId: row.providerCorrelationId,
    status: row.status as BatchInferenceItemRecord["status"],
    input: row.inputJson as GenerateCompletionInput,
    result: row.resultJson ?? undefined,
    usage: row.usageJson ?? undefined,
    errorCode: row.errorCode ?? undefined,
    errorMessage: row.errorMessage ?? undefined,
    estimatedCostMicros: row.estimatedCostMicros ?? undefined,
  };
}

export class PostgresBatchInferenceJobRepository implements BatchInferenceJobRepository {
  constructor(private readonly database: Database) {}

  async createJobWithItems(input: CreateBatchInferenceJobInput): Promise<void> {
    try {
      await this.database.db.transaction(async (tx) => {
        const job = input.job;
        await tx.insert(batchInferenceJobs).values({
          id: job.id,
          workspaceId: job.workspaceId,
          status: job.status,
          provider: job.provider,
          modelProfileVersionId: job.modelProfileVersionId,
          providerConnectionVersionId: job.providerConnectionVersionId,
          providerModelId: job.providerModelId,
          submissionFingerprint: job.submissionFingerprint,
          requestMaterialHash: job.requestMaterialHash,
          pricingSnapshotId: job.pricingSnapshotId,
          pricingSnapshotJson: job.pricingSnapshot,
          reconciliationRequired: job.reconciliationRequired,
          progressTotal: job.progressTotal,
          progressPending: job.progressPending,
          progressProcessing: job.progressProcessing,
          progressSucceeded: job.progressSucceeded,
          progressFailed: job.progressFailed,
          progressCancelled: job.progressCancelled,
          progressExpired: job.progressExpired,
          reconcileAfterAt: job.reconcileAfterAt,
          createdAt: job.createdAt,
          updatedAt: job.updatedAt,
        });
        if (input.items.length > 0) {
          await tx.insert(batchInferenceItems).values(
            input.items.map((item) => ({
              id: item.id,
              jobId: item.jobId,
              workspaceId: item.workspaceId,
              providerCorrelationId: item.providerCorrelationId,
              status: item.status,
              inputJson: item.input,
              createdAt: job.createdAt,
              updatedAt: job.updatedAt,
            })),
          );
        }
      });
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }

  async findJobById(
    workspaceId: WorkspaceId,
    jobId: BatchInferenceJobId,
  ): Promise<BatchInferenceJobRecord | null> {
    const [row] = await this.database.db
      .select()
      .from(batchInferenceJobs)
      .where(
        and(
          eq(batchInferenceJobs.id, jobId),
          eq(batchInferenceJobs.workspaceId, workspaceId),
        ),
      )
      .limit(1);
    return row === undefined ? null : rowToJob(row);
  }

  async listJobs(
    workspaceId: WorkspaceId,
    options: { readonly limit: number; readonly cursor?: string },
  ): Promise<{
    readonly jobs: readonly BatchInferenceJobRecord[];
    readonly nextCursor?: string;
  }> {
    const rows = await this.database.db
      .select()
      .from(batchInferenceJobs)
      .where(
        options.cursor !== undefined
          ? and(
              eq(batchInferenceJobs.workspaceId, workspaceId),
              gt(batchInferenceJobs.id, options.cursor),
            )
          : eq(batchInferenceJobs.workspaceId, workspaceId),
      )
      .orderBy(asc(batchInferenceJobs.id))
      .limit(options.limit + 1);
    const hasMore = rows.length > options.limit;
    const slice = hasMore ? rows.slice(0, options.limit) : rows;
    return {
      jobs: slice.map(rowToJob),
      nextCursor: hasMore ? slice[slice.length - 1]?.id : undefined,
    };
  }

  async listItemsByJobId(
    workspaceId: WorkspaceId,
    jobId: BatchInferenceJobId,
    options: { readonly limit: number; readonly cursor?: string },
  ): Promise<{
    readonly items: readonly BatchInferenceItemRecord[];
    readonly nextCursor?: string;
  }> {
    const rows = await this.database.db
      .select()
      .from(batchInferenceItems)
      .where(
        and(
          eq(batchInferenceItems.jobId, jobId),
          eq(batchInferenceItems.workspaceId, workspaceId),
          options.cursor !== undefined
            ? gt(batchInferenceItems.id, options.cursor)
            : sql`true`,
        ),
      )
      .orderBy(asc(batchInferenceItems.id))
      .limit(options.limit + 1);
    const hasMore = rows.length > options.limit;
    const slice = hasMore ? rows.slice(0, options.limit) : rows;
    return {
      items: slice.map(rowToItem),
      nextCursor: hasMore ? slice[slice.length - 1]?.id : undefined,
    };
  }

  async claimSubmissionLease(
    jobId: BatchInferenceJobId,
    owner: string,
    expiresAt: Date,
  ): Promise<boolean> {
    const result = await this.database.db
      .update(batchInferenceJobs)
      .set({
        submissionLeaseOwner: owner,
        submissionLeaseExpiresAt: expiresAt,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(batchInferenceJobs.id, jobId),
          inArray(batchInferenceJobs.status, ["CREATED", "SUBMITTING"]),
          or(
            sql`${batchInferenceJobs.submissionLeaseExpiresAt} is null`,
            lte(batchInferenceJobs.submissionLeaseExpiresAt, new Date()),
            eq(batchInferenceJobs.submissionLeaseOwner, owner),
          ),
        ),
      )
      .returning({ id: batchInferenceJobs.id });
    return result.length > 0;
  }

  async markSubmitting(
    jobId: BatchInferenceJobId,
    fromStatus: BatchInferenceJobStatus,
  ): Promise<boolean> {
    const result = await this.database.db
      .update(batchInferenceJobs)
      .set({ status: "SUBMITTING", updatedAt: new Date() })
      .where(
        and(
          eq(batchInferenceJobs.id, jobId),
          eq(batchInferenceJobs.status, fromStatus),
        ),
      )
      .returning({ id: batchInferenceJobs.id });
    return result.length > 0;
  }

  async markSubmitted(
    jobId: BatchInferenceJobId,
    input: {
      readonly providerBatchId: string;
      readonly providerJobStatus: BatchInferenceProviderJobStatus;
      readonly reconcileAfterAt: Date;
    },
  ): Promise<boolean> {
    const result = await this.database.db
      .update(batchInferenceJobs)
      .set({
        status: "SUBMITTED",
        providerBatchId: input.providerBatchId,
        providerJobStatus: input.providerJobStatus,
        reconcileAfterAt: input.reconcileAfterAt,
        reconciliationRequired: false,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(batchInferenceJobs.id, jobId),
          eq(batchInferenceJobs.status, "SUBMITTING"),
          or(
            isNull(batchInferenceJobs.providerBatchId),
            eq(batchInferenceJobs.providerBatchId, ""),
          ),
        ),
      )
      .returning({ id: batchInferenceJobs.id });
    return result.length > 0;
  }

  async markSubmissionAmbiguous(
    jobId: BatchInferenceJobId,
    note: string,
  ): Promise<void> {
    await this.database.db
      .update(batchInferenceJobs)
      .set({
        reconciliationRequired: true,
        reconciliationNote: note,
        status: "SUBMITTING",
        updatedAt: new Date(),
      })
      .where(eq(batchInferenceJobs.id, jobId));
  }

  async updateJobProgress(
    jobId: BatchInferenceJobId,
    patch: BatchInferenceJobProgressPatch,
  ): Promise<void> {
    await this.database.db
      .update(batchInferenceJobs)
      .set({
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
          ? { reconcileAfterAt: patch.reconcileAfterAt }
          : {}),
        ...(patch.reconciliationRequired !== undefined
          ? { reconciliationRequired: patch.reconciliationRequired }
          : {}),
        ...(patch.reconciliationNote !== undefined
          ? { reconciliationNote: patch.reconciliationNote }
          : {}),
        updatedAt: new Date(),
      })
      .where(eq(batchInferenceJobs.id, jobId));
  }

  async requestCancellation(
    workspaceId: WorkspaceId,
    jobId: BatchInferenceJobId,
  ): Promise<boolean> {
    const result = await this.database.db
      .update(batchInferenceJobs)
      .set({
        status: "CANCELLING",
        reconcileAfterAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(batchInferenceJobs.id, jobId),
          eq(batchInferenceJobs.workspaceId, workspaceId),
          inArray(batchInferenceJobs.status, [
            "CREATED",
            "SUBMITTING",
            "SUBMITTED",
            "PROCESSING",
            "FINALIZING",
          ]),
        ),
      )
      .returning({ id: batchInferenceJobs.id });
    return result.length > 0;
  }

  async findJobByIdInternal(
    jobId: BatchInferenceJobId,
  ): Promise<BatchInferenceJobRecord | null> {
    const [row] = await this.database.db
      .select()
      .from(batchInferenceJobs)
      .where(eq(batchInferenceJobs.id, jobId))
      .limit(1);
    return row === undefined ? null : rowToJob(row);
  }

  async listItemsForJob(
    jobId: BatchInferenceJobId,
  ): Promise<readonly BatchInferenceItemRecord[]> {
    const rows = await this.database.db
      .select()
      .from(batchInferenceItems)
      .where(eq(batchInferenceItems.jobId, jobId));
    return rows.map(rowToItem);
  }

  async updateItemOutcome(
    itemId: BatchInferenceItemId,
    patch: Parameters<BatchInferenceJobRepository["updateItemOutcome"]>[1],
  ): Promise<void> {
    await this.database.db
      .update(batchInferenceItems)
      .set({
        status: patch.status,
        resultJson: patch.result,
        usageJson: patch.usage,
        errorCode: patch.errorCode,
        errorMessage: patch.errorMessage,
        estimatedCostMicros: patch.estimatedCostMicros,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(batchInferenceItems.id, itemId),
          inArray(batchInferenceItems.status, [
            "PENDING",
            "SUBMITTED",
            "PROCESSING",
            "UNKNOWN",
          ]),
        ),
      );
  }

  async findDueJobs(
    limit: number,
    now: Date,
  ): Promise<readonly BatchInferenceJobRecord[]> {
    const rows = await this.database.db
      .select()
      .from(batchInferenceJobs)
      .where(
        and(
          inArray(batchInferenceJobs.status, [...NONTERMINAL]),
          isNotNull(batchInferenceJobs.reconcileAfterAt),
          lte(batchInferenceJobs.reconcileAfterAt, now),
        ),
      )
      .orderBy(asc(batchInferenceJobs.reconcileAfterAt))
      .limit(limit);
    return rows.map(rowToJob);
  }

  async findJobBySubmissionFingerprint(
    workspaceId: WorkspaceId,
    submissionFingerprint: string,
  ): Promise<BatchInferenceJobRecord | null> {
    const [row] = await this.database.db
      .select()
      .from(batchInferenceJobs)
      .where(
        and(
          eq(batchInferenceJobs.workspaceId, workspaceId),
          eq(batchInferenceJobs.submissionFingerprint, submissionFingerprint),
        ),
      )
      .limit(1);
    return row === undefined ? null : rowToJob(row);
  }
}

export class PostgresWorkspaceBatchInferencePolicyRepository implements WorkspaceBatchInferencePolicyRepository {
  constructor(private readonly database: Database) {}

  async findPolicyByWorkspaceId(
    workspaceId: WorkspaceId,
  ): Promise<BatchInferenceEligibilityPolicy | null> {
    const [row] = await this.database.db
      .select()
      .from(workspaceBatchInferencePolicies)
      .where(eq(workspaceBatchInferencePolicies.workspaceId, workspaceId))
      .limit(1);
    if (row === undefined) return null;
    return {
      batchInferenceEnabled: row.batchInferenceEnabled,
      denySensitiveWorkloads: row.denySensitiveWorkloads,
      maxItemCount: row.maxItemCount ?? undefined,
      allowedProviders:
        row.allowedProviders === null || row.allowedProviders.length === 0
          ? undefined
          : (row.allowedProviders.split(
              ",",
            ) as BatchInferenceEligibilityPolicy["allowedProviders"]),
    };
  }

  async upsertPolicy(
    workspaceId: WorkspaceId,
    policy: BatchInferenceEligibilityPolicy,
  ): Promise<void> {
    const allowedProviders =
      policy.allowedProviders !== undefined
        ? policy.allowedProviders.join(",")
        : null;
    await this.database.db
      .insert(workspaceBatchInferencePolicies)
      .values({
        workspaceId,
        schemaVersion: "1",
        batchInferenceEnabled: policy.batchInferenceEnabled,
        denySensitiveWorkloads: policy.denySensitiveWorkloads ?? true,
        maxItemCount: policy.maxItemCount ?? null,
        allowedProviders,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: workspaceBatchInferencePolicies.workspaceId,
        set: {
          batchInferenceEnabled: policy.batchInferenceEnabled,
          denySensitiveWorkloads: policy.denySensitiveWorkloads ?? true,
          maxItemCount: policy.maxItemCount ?? null,
          allowedProviders,
          updatedAt: new Date(),
        },
      });
  }
}

export function defaultBatchPolicyForWorkspace(): BatchInferenceEligibilityPolicy {
  return createDefaultBatchInferenceEligibilityPolicy();
}
