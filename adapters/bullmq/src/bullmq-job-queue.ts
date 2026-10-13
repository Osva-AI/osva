import { Queue, Worker, type Job } from "bullmq";
import type {
  JobEnqueueResult,
  JobQueueHandler,
  RunAttemptId,
} from "@osva-ai/contracts";
import {
  extractBullMqTraceCarrier,
  OSVA_ATTR,
  OSVA_METRIC,
  OSVA_SPAN,
  resolveInstrumentation,
  withBullMqTraceCarrier,
  type OsvaInstrumentation,
} from "@osva/observability";

import { checkValkeyConnection } from "./check-valkey-connection.js";
import {
  DEFAULT_WORKER_CONCURRENCY,
  EXECUTE_RUN_ATTEMPT_JOB_NAME,
  OSVA_EXECUTION_QUEUE_NAME,
} from "./constants.js";
import { JobQueueShutdownError, UnsupportedQueueJobError } from "./errors.js";
import { enqueueWithTransportClaim } from "./enqueue-claim.js";
import { toBullMqJobId } from "./job-id.js";
import { parseExecutionJobPayload } from "./payload.js";
import type { PingableJobQueue } from "./pingable-job-queue.js";
import {
  DEFAULT_QUEUE_METRICS_POLL_MS,
  QUEUE_METRIC_STATES,
  queueMetricLabel,
  queueTimeToStartMs,
  type QueueMetricState,
} from "./queue-metrics.js";

export interface BullMqJobQueueLogger {
  info(event: string, fields?: Readonly<Record<string, unknown>>): void;
  error(event: string, error: unknown): void;
}

export interface BullMqJobQueueOptions {
  readonly url: string;
  readonly queueName?: string;
  readonly prefix?: string;
  readonly concurrency?: number;
  readonly logger?: BullMqJobQueueLogger;
  readonly instrumentation?: OsvaInstrumentation;
  readonly metricsPollIntervalMs?: number;
}

export interface QueuedExecutionJob {
  readonly id: string;
  readonly name: string;
  readonly data: unknown;
}

interface BullMqConnectionOptions {
  readonly url: string;
  readonly maxRetriesPerRequest: null;
}

/**
 * BullMQ JobQueue adapter. Queue name, job name, and job IDs stay inside
 * this infrastructure boundary.
 */
export class BullMqJobQueue implements PingableJobQueue {
  private readonly url: string;
  private readonly queueName: string;
  private readonly prefix: string | undefined;
  private readonly concurrency: number;
  private readonly logger: BullMqJobQueueLogger | undefined;
  private readonly instrumentation: OsvaInstrumentation | undefined;
  private readonly metricsPollIntervalMs: number;
  private readonly queueLabel: string;
  private readonly connection: BullMqConnectionOptions;
  private readonly queue: Queue;
  private worker: Worker | undefined;
  private handler: JobQueueHandler | undefined;
  private closed = false;
  private metricsTimer: ReturnType<typeof setInterval> | undefined;
  private metricsPoll: Promise<void> | undefined;

  constructor(options: BullMqJobQueueOptions) {
    this.url = options.url;
    this.queueName = options.queueName ?? OSVA_EXECUTION_QUEUE_NAME;
    this.prefix = options.prefix;
    this.concurrency = options.concurrency ?? DEFAULT_WORKER_CONCURRENCY;
    this.logger = options.logger;
    this.instrumentation = options.instrumentation;
    this.metricsPollIntervalMs =
      options.metricsPollIntervalMs ?? DEFAULT_QUEUE_METRICS_POLL_MS;
    this.queueLabel = queueMetricLabel(
      options.queueName ?? OSVA_EXECUTION_QUEUE_NAME,
    );
    this.connection = {
      url: options.url,
      maxRetriesPerRequest: null,
    };
    this.queue = new Queue(this.queueName, {
      connection: this.connection,
      prefix: this.prefix,
    });
  }

  async ping(): Promise<void> {
    this.assertOpen("ping");
    await checkValkeyConnection(this.url);
  }

  async enqueue(runAttemptId: RunAttemptId): Promise<JobEnqueueResult> {
    this.assertOpen("enqueue");
    const jobId = toBullMqJobId(runAttemptId);

    const carrier = this.instrumentation?.injectTraceContext();
    const payload = withBullMqTraceCarrier(
      Object.freeze({ runAttemptId }),
      carrier,
    );

    try {
      const outcome = await enqueueWithTransportClaim(
        this.queue,
        jobId,
        async () => {
          await this.queue.add(EXECUTE_RUN_ATTEMPT_JOB_NAME, payload, {
            jobId,
          });
        },
      );
      return { outcome };
    } catch (error) {
      if (isDuplicateJobError(error)) {
        return { outcome: "already_present" };
      }
      throw error;
    }
  }

  async cancel(runAttemptId: RunAttemptId): Promise<void> {
    if (this.closed) {
      return;
    }

    const jobId = toBullMqJobId(runAttemptId);
    const job = await this.queue.getJob(jobId);
    if (job !== undefined) {
      const state = await job.getState();
      if (state !== "completed" && state !== "failed" && state !== "active") {
        await job.remove();
      }
    }

    await this.clearEnqueueClaim(jobId);
  }

  async consume(handler: JobQueueHandler): Promise<void> {
    this.assertOpen("consume");
    if (this.worker !== undefined) {
      throw new Error("BullMqJobQueue is already consuming.");
    }

    this.handler = handler;
    const worker = new Worker(
      this.queueName,
      async (job: Job) => this.processJob(job),
      {
        connection: this.connection,
        prefix: this.prefix,
        concurrency: this.concurrency,
      },
    );

    worker.on("stalled", (jobId) => {
      this.logger?.info("worker.job_stalled", { jobId });
      this.recordQueueCounter(OSVA_METRIC.QUEUE_STALLED);
    });
    worker.on("error", (error) => {
      this.logger?.error("worker.queue_error", error);
      this.recordQueueCounter(OSVA_METRIC.QUEUE_JOB_ERRORS, { kind: "error" });
    });
    worker.on("failed", (_job, error) => {
      this.logger?.error("worker.job_failed", error);
      this.recordQueueCounter(OSVA_METRIC.QUEUE_JOB_ERRORS, { kind: "failed" });
    });

    this.worker = worker;
    await worker.waitUntilReady();
    this.startMetricsPolling();
  }

  async shutdown(): Promise<void> {
    this.closed = true;
    this.stopMetricsPolling();
    if (this.metricsPoll !== undefined) {
      await this.metricsPoll.catch(() => undefined);
    }

    const worker = this.worker;
    this.worker = undefined;
    this.handler = undefined;

    if (worker !== undefined) {
      await worker.close();
    }

    await this.queue.close();
  }

  private async clearEnqueueClaim(jobId: string): Promise<void> {
    await this.queue.waitUntilReady();
    const client = await this.queue.client;
    await client.del(`${this.queue.toKey("osva-enqueue-claim")}:${jobId}`);
  }

  /**
   * Adapter-only inspection for tests. Not part of the JobQueue port.
   */
  async getQueuedJob(
    runAttemptId: RunAttemptId,
  ): Promise<QueuedExecutionJob | null> {
    const job = await this.queue.getJob(toBullMqJobId(runAttemptId));
    if (job === undefined || job.id === undefined) {
      return null;
    }

    return {
      id: job.id,
      name: job.name,
      data: job.data,
    };
  }

  /**
   * Adapter-only inspection for tests. Counts waiting/active/delayed jobs.
   */
  async countActiveJobs(): Promise<number> {
    const counts = await this.queue.getJobCounts(
      "wait",
      "waiting-children",
      "active",
      "delayed",
      "paused",
    );
    return (
      (counts["wait"] ?? 0) +
      (counts["waiting-children"] ?? 0) +
      (counts["active"] ?? 0) +
      (counts["delayed"] ?? 0) +
      (counts["paused"] ?? 0)
    );
  }

  private async processJob(job: Job): Promise<void> {
    if (job.name !== EXECUTE_RUN_ATTEMPT_JOB_NAME) {
      throw new UnsupportedQueueJobError(job.name);
    }

    const payload = parseExecutionJobPayload(job.data);
    const traceCarrier = extractBullMqTraceCarrier(job.data);
    const handler = this.handler;
    if (handler === undefined) {
      throw new Error("Execution job handler is not registered.");
    }

    const invoke = async () => {
      const telemetry = resolveInstrumentation(this.instrumentation);
      const startedAt = Date.now();
      const timeToStartMs = queueTimeToStartMs(job.timestamp, startedAt);
      if (timeToStartMs !== undefined) {
        try {
          telemetry.recordHistogram(
            OSVA_METRIC.QUEUE_TIME_TO_START_MS,
            timeToStartMs,
            { queue: this.queueLabel },
          );
        } catch {
          // Queue metrics must never fail job processing.
        }
      }

      await telemetry.withSpan(
        OSVA_SPAN.QUEUE_PROCESS,
        {
          [OSVA_ATTR.RUN_ATTEMPT_ID]: payload.runAttemptId,
        },
        async () => {
          try {
            await handler(payload);
          } catch (error) {
            this.logger?.error("worker.job_processing_failed", error);
            throw error;
          }
        },
      );
    };

    if (this.instrumentation === undefined) {
      await invoke();
      return;
    }

    await this.instrumentation.runWithExtractedContext(traceCarrier, invoke);
  }

  private startMetricsPolling(): void {
    if (this.metricsPollIntervalMs <= 0 || this.metricsTimer !== undefined) {
      return;
    }

    this.metricsTimer = setInterval(() => {
      void this.pollQueueCounts();
    }, this.metricsPollIntervalMs);
    this.metricsTimer.unref?.();
    void this.pollQueueCounts();
  }

  private stopMetricsPolling(): void {
    if (this.metricsTimer !== undefined) {
      clearInterval(this.metricsTimer);
      this.metricsTimer = undefined;
    }
  }

  private async pollQueueCounts(): Promise<void> {
    if (this.closed || this.metricsPoll !== undefined) {
      return;
    }

    this.metricsPoll = this.collectQueueCounts();
    try {
      await this.metricsPoll;
    } finally {
      this.metricsPoll = undefined;
    }
  }

  private async collectQueueCounts(): Promise<void> {
    const telemetry = resolveInstrumentation(this.instrumentation);
    try {
      const counts = await this.queue.getJobCounts(
        "wait",
        "active",
        "delayed",
        "failed",
      );
      const values: Record<QueueMetricState, number> = {
        waiting: counts.wait ?? 0,
        active: counts.active ?? 0,
        delayed: counts.delayed ?? 0,
        failed: counts.failed ?? 0,
      };
      for (const state of QUEUE_METRIC_STATES) {
        telemetry.recordGauge(OSVA_METRIC.QUEUE_JOBS, values[state], {
          queue: this.queueLabel,
          state,
        });
      }
    } catch {
      // Queue gauges must never fail consumption.
    }
  }

  private recordQueueCounter(
    name: string,
    attributes: Readonly<Record<string, string>> = {},
  ): void {
    try {
      resolveInstrumentation(this.instrumentation).recordCounter(name, 1, {
        queue: this.queueLabel,
        ...attributes,
      });
    } catch {
      // Queue counters must never fail consumption.
    }
  }

  private assertOpen(operation: string): void {
    if (this.closed) {
      throw new JobQueueShutdownError(operation);
    }
  }
}

function isDuplicateJobError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const message = error.message.toLowerCase();
  return (
    message.includes("already exists") ||
    message.includes("job is already") ||
    error.name === "DuplicateJobError"
  );
}
