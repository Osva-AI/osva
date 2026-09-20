import { Queue, Worker, type Job } from "bullmq";
import type { KnowledgeIndexId } from "@osva/contracts";

export type KnowledgeIndexQueueHandler = (
  knowledgeIndexId: KnowledgeIndexId,
) => Promise<void>;

import { checkValkeyConnection } from "./check-valkey-connection.js";
import { createValkeyConnection } from "./connection.js";
import { JobQueueShutdownError } from "./errors.js";

export const OSVA_KNOWLEDGE_INDEX_QUEUE_NAME = "osva-knowledge-index";
export const INGEST_KNOWLEDGE_INDEX_JOB_NAME = "ingest-knowledge-index";

export interface BullMqKnowledgeIndexQueueOptions {
  readonly url: string;
  readonly queueName?: string;
  readonly prefix?: string;
  readonly concurrency?: number;
}

export class BullMqKnowledgeIndexQueue {
  private readonly url: string;
  private readonly queueName: string;
  private readonly prefix: string | undefined;
  private readonly concurrency: number;
  private readonly connection: ReturnType<typeof createValkeyConnection>;
  private readonly queue: Queue;
  private worker: Worker | undefined;
  private closed = false;

  constructor(options: BullMqKnowledgeIndexQueueOptions) {
    this.url = options.url;
    this.queueName = options.queueName ?? OSVA_KNOWLEDGE_INDEX_QUEUE_NAME;
    this.prefix = options.prefix;
    this.concurrency = options.concurrency ?? 2;
    this.connection = createValkeyConnection(options.url);
    this.queue = new Queue(this.queueName, {
      connection: this.connection,
      prefix: this.prefix,
    });
  }

  async ping(): Promise<void> {
    await checkValkeyConnection(this.url);
  }

  async enqueue(knowledgeIndexId: KnowledgeIndexId): Promise<void> {
    this.assertOpen("enqueue");
    try {
      await this.queue.add(
        INGEST_KNOWLEDGE_INDEX_JOB_NAME,
        Object.freeze({ knowledgeIndexId }),
        { jobId: knowledgeIndexId },
      );
    } catch (error) {
      if (isDuplicateJobError(error)) {
        return;
      }
      throw error;
    }
  }

  async start(handler: KnowledgeIndexQueueHandler): Promise<void> {
    this.assertOpen("start");
    if (this.worker !== undefined) {
      return;
    }

    this.worker = new Worker(
      this.queueName,
      async (job: Job) => {
        if (job.name !== INGEST_KNOWLEDGE_INDEX_JOB_NAME) {
          return;
        }
        const payload = job.data as { knowledgeIndexId?: KnowledgeIndexId };
        if (payload.knowledgeIndexId === undefined) {
          return;
        }
        await handler(payload.knowledgeIndexId);
      },
      {
        connection: this.connection,
        prefix: this.prefix,
        concurrency: this.concurrency,
      },
    );
  }

  async stop(): Promise<void> {
    if (this.closed) {
      return;
    }
    this.closed = true;
    await this.worker?.close();
    await this.queue.close();
  }

  private assertOpen(operation: string): void {
    if (this.closed) {
      throw new JobQueueShutdownError(operation);
    }
  }
}

function isDuplicateJobError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.message.includes("JobId") || error.message.includes("jobId"))
  );
}
