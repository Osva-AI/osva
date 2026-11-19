import {
  assertBatchInferenceJobStatusTransition,
  canTransitionBatchInferenceJobStatus,
  formatBatchInferenceCorrelationAnomalyNote,
  MODEL_ERROR_CODES,
  partitionBatchInferenceProviderCorrelations,
  reconcileBatchInferenceItemOutcomes,
  type BatchInferenceItemOutcome,
  type BatchInferenceItemStatus,
  type BatchInferenceJobStatus,
} from "@osva-ai/contracts";
import type {
  BatchInferenceJobRecord,
  BatchInferenceJobRepository,
  BatchInferenceItemRecord,
} from "@osva/domain";
import type {
  BatchInferenceProviderAdapter,
  BatchInferenceProviderItemResult,
} from "@osva/model-gateway";

import { estimateBatchItemCostUsdMicros } from "./batch-inference-item-cost.js";
import type { BatchInferenceMetrics } from "./batch-inference-metrics.js";
import { noopBatchInferenceMetrics } from "./batch-inference-metrics.js";

export interface ProcessBatchInferenceJobsDependencies {
  readonly jobs: BatchInferenceJobRepository;
  readonly resolveAdapter: (
    job: BatchInferenceJobRecord,
  ) => Promise<BatchInferenceProviderAdapter>;
  readonly loadItems: (
    jobId: BatchInferenceJobRecord["id"],
  ) => Promise<readonly BatchInferenceItemRecord[]>;
  readonly clock: { now(): Date };
  readonly workerId: string;
  readonly metrics?: {
    poll(jobId: string): void;
    reconcile(jobId: string): void;
    submit(jobId: string): void;
  };
  readonly batchMetrics?: BatchInferenceMetrics;
}

export interface ProcessBatchInferenceJobsOptions {
  readonly batchLimit: number;
}

export class ProcessBatchInferenceJobs {
  private aborted = false;
  private readonly batchMetrics: BatchInferenceMetrics;

  constructor(private readonly deps: ProcessBatchInferenceJobsDependencies) {
    this.batchMetrics = deps.batchMetrics ?? noopBatchInferenceMetrics;
  }

  abortInFlight(): void {
    this.aborted = true;
  }

  async execute(options: ProcessBatchInferenceJobsOptions): Promise<void> {
    const now = this.deps.clock.now();
    const due = await this.deps.jobs.findDueJobs(options.batchLimit, now);
    for (const job of due) {
      if (this.aborted) return;
      await this.processJob(job);
    }
  }

  private async processJob(job: BatchInferenceJobRecord): Promise<void> {
    if (job.status === "CREATED") {
      await this.submitJob(job);
      return;
    }
    if (job.status === "SUBMITTING") {
      if (job.reconciliationRequired) {
        return;
      }
    }
    if (
      job.status === "SUBMITTED" ||
      job.status === "PROCESSING" ||
      job.status === "FINALIZING" ||
      job.status === "CANCELLING" ||
      job.status === "SUBMITTING"
    ) {
      await this.reconcileJob(job);
    }
  }

  private async submitJob(job: BatchInferenceJobRecord): Promise<void> {
    const leaseOk = await this.deps.jobs.claimSubmissionLease(
      job.id,
      this.deps.workerId,
      new Date(this.deps.clock.now().getTime() + 120_000),
    );
    if (!leaseOk) return;

    if (job.reconciliationRequired) {
      this.batchMetrics.recordReconciliationRequired({
        provider: job.provider,
      });
      return;
    }

    const moved = await this.deps.jobs.markSubmitting(job.id, "CREATED");
    if (!moved) return;

    this.deps.metrics?.submit(job.id);
    this.batchMetrics.recordSubmissionAttempt({ provider: job.provider });

    const adapter = await this.deps.resolveAdapter(job);
    const items = await this.deps.loadItems(job.id);

    try {
      const result = await adapter.submit({
        provider: job.provider,
        providerModelId: job.providerModelId,
        items: items.map((item) => ({
          itemId: item.id,
          providerCorrelationId: item.providerCorrelationId,
          input: item.input,
        })),
      });
      const marked = await this.deps.jobs.markSubmitted(job.id, {
        providerBatchId: result.providerBatchId,
        providerJobStatus: result.providerJobStatus,
        reconcileAfterAt: new Date(this.deps.clock.now().getTime() + 5_000),
      });
      if (!marked) {
        return;
      }
      await this.transition(job.id, "SUBMITTING", "SUBMITTED");
      this.batchMetrics.recordSubmissionSuccess({ provider: job.provider });
    } catch (error) {
      this.batchMetrics.recordSubmissionFailure({ provider: job.provider });
      await this.deps.jobs.markSubmissionAmbiguous(
        job.id,
        error instanceof Error ? error.message : "submit failed",
      );
    }
  }

  private async reconcileJob(job: BatchInferenceJobRecord): Promise<void> {
    if (job.providerBatchId === undefined) {
      return;
    }

    this.deps.metrics?.poll(job.id);
    const adapter = await this.deps.resolveAdapter(job);

    const providerBatchId = job.providerBatchId;
    if (job.status === "CANCELLING" && providerBatchId !== undefined) {
      await adapter.requestCancellation(providerBatchId);
      this.batchMetrics.recordCancellation({ provider: job.provider });
    }
    const status = await adapter.getStatus(providerBatchId);
    const items = await this.deps.loadItems(job.id);

    let nextStatus: BatchInferenceJobStatus = job.status;
    if (
      job.status === "SUBMITTED" &&
      status.providerJobStatus === "IN_PROGRESS"
    ) {
      nextStatus = "PROCESSING";
    }
    if (
      status.providerJobStatus === "COMPLETED" ||
      status.providerJobStatus === "FAILED" ||
      status.providerJobStatus === "CANCELLED" ||
      status.providerJobStatus === "EXPIRED"
    ) {
      if (job.status !== "CANCELLING") {
        nextStatus = "FINALIZING";
      }
    }

    if (
      nextStatus !== job.status &&
      canTransitionBatchInferenceJobStatus(job.status, nextStatus)
    ) {
      await this.transition(job.id, job.status, nextStatus);
      job = { ...job, status: nextStatus };
    }

    if (
      job.status !== "FINALIZING" &&
      job.status !== "PROCESSING" &&
      job.status !== "CANCELLING"
    ) {
      await this.deps.jobs.updateJobProgress(job.id, {
        providerJobStatus: status.providerJobStatus,
        reconcileAfterAt: new Date(this.deps.clock.now().getTime() + 15_000),
      });
      return;
    }

    this.batchMetrics.recordReconciliationAttempt({ provider: job.provider });

    let page;
    try {
      page = await adapter.fetchResults(providerBatchId, {
        outputFileId: status.outputFileId,
        errorFileId: status.errorFileId,
      });
    } catch {
      this.batchMetrics.recordReconciliationFailure({ provider: job.provider });
      await this.deps.jobs.updateJobProgress(job.id, {
        providerJobStatus: status.providerJobStatus,
        reconcileAfterAt: new Date(this.deps.clock.now().getTime() + 15_000),
      });
      return;
    }

    this.deps.metrics?.reconcile(job.id);

    const correlationToItem = new Map(
      items.map((item) => [item.providerCorrelationId, item] as const),
    );

    const partition = partitionBatchInferenceProviderCorrelations(
      items.map((item) => item.providerCorrelationId),
      page.items,
    );
    if (partition.hasCorrelationAnomaly) {
      this.batchMetrics.recordCorrelationAnomaly({ provider: job.provider });
      await this.deps.jobs.updateJobProgress(job.id, {
        reconciliationRequired: true,
        reconciliationNote:
          formatBatchInferenceCorrelationAnomalyNote(partition),
        providerJobStatus: status.providerJobStatus,
        reconcileAfterAt: new Date(this.deps.clock.now().getTime() + 15_000),
      });
    }

    for (const providerItem of partition.applicable) {
      const item = correlationToItem.get(providerItem.providerCorrelationId);
      if (item === undefined) {
        continue;
      }
      if (
        item.status === "SUCCEEDED" ||
        item.status === "FAILED" ||
        item.status === "CANCELLED" ||
        item.status === "EXPIRED"
      ) {
        continue;
      }
      const itemStatus = mapProviderItemStatus(providerItem);
      const estimatedCostMicros = estimateBatchItemCostUsdMicros({
        usage: providerItem.usage,
        pricing: job.pricingSnapshot,
        configuredProviderModelId: job.providerModelId,
      });
      await this.deps.jobs.updateItemOutcome(item.id, {
        status: itemStatus,
        result: providerItem.result,
        usage: providerItem.usage,
        errorCode: providerItem.error?.code,
        errorMessage: providerItem.error?.message,
        estimatedCostMicros,
      });
      if (
        itemStatus === "SUCCEEDED" ||
        itemStatus === "FAILED" ||
        itemStatus === "CANCELLED" ||
        itemStatus === "EXPIRED"
      ) {
        this.batchMetrics.recordItemTerminal({
          provider: job.provider,
          status: itemStatus,
        });
      }
    }

    const refreshedItems = await this.deps.loadItems(job.id);
    const report = reconcileBatchInferenceItemOutcomes(
      refreshedItems.map((i) => i.id),
      refreshedItems
        .filter((i) => isTerminalBatchItemStatus(i.status))
        .map((i) => toBatchInferenceItemOutcome(i)),
    );

    const progress = summarizeProgress(refreshedItems);
    const terminal = deriveTerminalJobStatus(
      progress,
      status.providerJobStatus,
      report,
    );

    if (
      terminal !== null &&
      canTransitionBatchInferenceJobStatus(job.status, terminal)
    ) {
      if (job.usageFinalizedAt !== undefined) {
        return;
      }
      const terminalOutcome =
        terminal === "PARTIALLY_COMPLETED"
          ? ("PARTIAL" as const)
          : terminal === "COMPLETED"
            ? "COMPLETED"
            : terminal === "FAILED"
              ? "FAILED"
              : terminal === "CANCELLED"
                ? "CANCELLED"
                : "EXPIRED";
      this.batchMetrics.recordProviderTerminalOutcome({
        provider: job.provider,
        outcome: terminalOutcome,
      });
      await this.deps.jobs.updateJobProgress(job.id, {
        status: terminal,
        ...progress,
        providerJobStatus: status.providerJobStatus,
        completedAt: this.deps.clock.now(),
        reconcileAfterAt: undefined,
        usageFinalizedAt: this.deps.clock.now(),
        estimatedCostMicros: sumItemCosts(refreshedItems),
      });
      await this.transition(job.id, job.status, terminal);
      return;
    }

    await this.deps.jobs.updateJobProgress(job.id, {
      ...progress,
      providerJobStatus: status.providerJobStatus,
      reconcileAfterAt: new Date(this.deps.clock.now().getTime() + 15_000),
    });
  }

  private async transition(
    jobId: BatchInferenceJobRecord["id"],
    from: BatchInferenceJobStatus,
    to: BatchInferenceJobStatus,
  ): Promise<void> {
    assertBatchInferenceJobStatusTransition(from, to);
    await this.deps.jobs.updateJobProgress(jobId, { status: to });
  }
}

function mapProviderItemStatus(
  providerItem: BatchInferenceProviderItemResult,
): BatchInferenceItemStatus {
  if (providerItem.error) {
    if (providerItem.error.code === MODEL_ERROR_CODES.MODEL_CANCELLED) {
      return "CANCELLED";
    }
    return "FAILED";
  }
  if (providerItem.result) return "SUCCEEDED";
  return "UNKNOWN";
}

function summarizeProgress(items: readonly BatchInferenceItemRecord[]) {
  const progress = {
    progressTotal: items.length,
    progressPending: 0,
    progressProcessing: 0,
    progressSucceeded: 0,
    progressFailed: 0,
    progressCancelled: 0,
    progressExpired: 0,
  };
  for (const item of items) {
    switch (item.status) {
      case "PENDING":
      case "SUBMITTED":
        progress.progressPending += 1;
        break;
      case "PROCESSING":
        progress.progressProcessing += 1;
        break;
      case "SUCCEEDED":
        progress.progressSucceeded += 1;
        break;
      case "FAILED":
        progress.progressFailed += 1;
        break;
      case "CANCELLED":
        progress.progressCancelled += 1;
        break;
      case "EXPIRED":
        progress.progressExpired += 1;
        break;
      default:
        break;
    }
  }
  return progress;
}

function isTerminalBatchItemStatus(status: BatchInferenceItemStatus): boolean {
  return (
    status === "SUCCEEDED" ||
    status === "FAILED" ||
    status === "CANCELLED" ||
    status === "EXPIRED"
  );
}

function toBatchInferenceItemOutcome(
  item: BatchInferenceItemRecord,
): BatchInferenceItemOutcome {
  return {
    itemId: item.id,
    providerCorrelationId: item.providerCorrelationId,
    status: item.status,
    result: item.result,
    usage: item.usage,
    error:
      item.errorCode !== undefined
        ? {
            code: item.errorCode as never,
            message: item.errorMessage ?? "failed",
          }
        : undefined,
  };
}

function deriveTerminalJobStatus(
  progress: ReturnType<typeof summarizeProgress>,
  providerStatus: string,
  report: ReturnType<typeof reconcileBatchInferenceItemOutcomes>,
): BatchInferenceJobStatus | null {
  if (
    providerStatus !== "COMPLETED" &&
    providerStatus !== "FAILED" &&
    providerStatus !== "CANCELLED" &&
    providerStatus !== "EXPIRED"
  ) {
    return null;
  }
  if (providerStatus === "CANCELLED") {
    if (progress.progressSucceeded > 0 || progress.progressFailed > 0) {
      return "PARTIALLY_COMPLETED";
    }
    return "CANCELLED";
  }
  if (providerStatus === "EXPIRED") {
    if (progress.progressSucceeded > 0) {
      return "PARTIALLY_COMPLETED";
    }
    return "EXPIRED";
  }
  if (!report.isComplete) {
    if (
      progress.progressSucceeded > 0 ||
      progress.progressFailed > 0 ||
      progress.progressCancelled > 0
    ) {
      return "PARTIALLY_COMPLETED";
    }
    return null;
  }
  if (progress.progressFailed > 0 && progress.progressSucceeded > 0) {
    return "PARTIALLY_COMPLETED";
  }
  if (progress.progressFailed === progress.progressTotal) {
    return "FAILED";
  }
  return "COMPLETED";
}

function sumItemCosts(
  items: readonly BatchInferenceItemRecord[],
): number | undefined {
  let sum = 0;
  let any = false;
  for (const item of items) {
    if (item.estimatedCostMicros !== undefined) {
      sum += item.estimatedCostMicros;
      any = true;
    }
  }
  return any ? sum : undefined;
}
