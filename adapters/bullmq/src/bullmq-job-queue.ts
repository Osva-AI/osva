import { Queue, Worker, type Job } from "bullmq";
import type { JobQueueHandler, RunAttemptId } from "@osva/contracts";

import { checkValkeyConnection } from "./check-valkey-connection.js";
import {
  DEFAULT_WORKER_CONCURRENCY,
  EXECUTE_RUN_ATTEMPT_JOB_NAME,
  OSVA_EXECUTION_QUEUE_NAME,
} from "./constants.js";
import { JobQueueShutdownError, UnsupportedQueueJobError } from "./errors.js";
import { toBullMqJobId } from "./job-id.js";
import { parseExecutionJobPayload } from "./payload.js";
import type { PingableJobQueue } from "./pingable-job-queue.js";

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
  private readonly connection: BullMqConnectionOptions;
  private readonly queue: Queue;
  private worker: Worker | undefined;
  private handler: JobQueueHandler | undefined;
  private closed = false;

  constructor(options: BullMqJobQueueOptions) {
    this.url = options.url;
    this.queueName = options.queueName ?? OSVA_EXECUTION_QUEUE_NAME;
    this.prefix = options.prefix;
    this.concurrency = options.concurrency ?? DEFAULT_WORKER_CONCURRENCY;
    this.logger = options.logger;
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

  async enqueue(runAttemptId: RunAttemptId): Promise<void> {
    this.assertOpen("enqueue");
    const jobId = toBullMqJobId(runAttemptId);

    try {
      await this.queue.add(
        EXECUTE_RUN_ATTEMPT_JOB_NAME,
        Object.freeze({ runAttemptId }),
        { jobId },
      );
    } catch (error) {
      if (isDuplicateJobError(error)) {
        return;
      }
      throw error;
    }
  }

  async cancel(runAttemptId: RunAttemptId): Promise<void> {
    if (this.closed) {
      return;
    }

    const job = await this.queue.getJob(toBullMqJobId(runAttemptId));
    if (job === undefined) {
      return;
    }

    const state = await job.getState();
    if (state === "completed" || state === "failed" || state === "active") {
      return;
    }

    await job.remove();
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
    });
    worker.on("error", (error) => {
      this.logger?.error("worker.queue_error", error);
    });
    worker.on("failed", (_job, error) => {
      this.logger?.error("worker.job_failed", error);
    });

    this.worker = worker;
    await worker.waitUntilReady();
  }

  async shutdown(): Promise<void> {
    this.closed = true;
    const worker = this.worker;
    this.worker = undefined;
    this.handler = undefined;

    if (worker !== undefined) {
      await worker.close();
    }

    await this.queue.close();
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
    const handler = this.handler;
    if (handler === undefined) {
      throw new Error("Execution job handler is not registered.");
    }

    try {
      await handler(payload);
    } catch (error) {
      this.logger?.error("worker.job_processing_failed", error);
      throw error;
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
