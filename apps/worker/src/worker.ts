export type WorkerStatus = "created" | "running" | "stopped";

export type WorkerReadinessCheck = () => Promise<void>;

export interface CreateWorkerApplicationOptions {
  readonly readinessCheck: WorkerReadinessCheck;
  readonly onClose?: () => Promise<void>;
}

export interface WorkerApplication {
  start(): Promise<void>;
  stop(): Promise<void>;
  status(): WorkerStatus;
}

/**
 * Stage 0 execution-worker process shell.
 *
 * The distributed JobQueue adapter is introduced in Stage 1. This process
 * does not consume jobs, create RunAttempts, or execute Runs.
 */
export function createWorkerApplication(
  options: CreateWorkerApplicationOptions,
): WorkerApplication {
  let status: WorkerStatus = "created";
  let stopping: Promise<void> | undefined;

  return {
    status() {
      return status;
    },

    async start() {
      if (status === "running") {
        return;
      }

      if (status === "stopped") {
        throw new Error("Worker has already stopped.");
      }

      await options.readinessCheck();
      status = "running";
    },

    stop() {
      if (status === "stopped") {
        return stopping ?? Promise.resolve();
      }

      if (stopping) {
        return stopping;
      }

      const close = options.onClose;
      status = "stopped";
      stopping = (async () => {
        if (close) {
          await close();
        }
      })();

      return stopping;
    },
  };
}
