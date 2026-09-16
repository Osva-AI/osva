export type WorkerStatus = "created" | "running" | "stopped";

export type WorkerReadinessCheck = () => Promise<void>;

export interface CreateWorkerApplicationOptions {
  readonly readinessCheck: WorkerReadinessCheck;
  readonly onStart?: () => Promise<void>;
  readonly onClose?: () => Promise<void>;
}

export interface WorkerApplication {
  start(): Promise<void>;
  stop(): Promise<void>;
  status(): WorkerStatus;
}

/**
 * Execution-worker process shell.
 *
 * Queue consumption is started through onStart after readiness succeeds.
 * Run/RunAttempt lifecycle remains in ExecuteRunAttempt.
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
      if (options.onStart) {
        await options.onStart();
      }
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
