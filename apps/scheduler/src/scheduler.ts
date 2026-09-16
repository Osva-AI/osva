export type SchedulerStatus = "created" | "running" | "stopped";

export type SchedulerReadinessCheck = () => Promise<void>;

export interface CreateSchedulerApplicationOptions {
  readonly readinessCheck: SchedulerReadinessCheck;
  readonly onTick: () => Promise<void>;
  readonly pollMs: number;
  readonly clock?: { now(): Date };
  readonly sleep?: (ms: number) => Promise<void>;
  readonly onClose?: () => Promise<void>;
}

export interface SchedulerApplication {
  start(): Promise<void>;
  stop(): Promise<void>;
  status(): SchedulerStatus;
  tickOnce(): Promise<void>;
}

export function createSchedulerApplication(
  options: CreateSchedulerApplicationOptions,
): SchedulerApplication {
  let status: SchedulerStatus = "created";
  let stopping: Promise<void> | undefined;
  let loopPromise: Promise<void> | undefined;
  let stopped = false;

  const sleep =
    options.sleep ??
    ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));

  return {
    status() {
      return status;
    },

    async tickOnce() {
      await options.onTick();
    },

    async start() {
      if (status === "running") {
        return;
      }

      if (status === "stopped") {
        throw new Error("Scheduler has already stopped.");
      }

      await options.readinessCheck();
      status = "running";
      stopped = false;

      loopPromise = (async () => {
        while (!stopped) {
          try {
            await options.onTick();
          } catch (error) {
            logLoopError(error);
          }

          await sleep(options.pollMs);
        }
      })();
    },

    stop() {
      if (status === "stopped") {
        return stopping ?? Promise.resolve();
      }

      if (stopping) {
        return stopping;
      }

      stopped = true;
      status = "stopped";
      stopping = (async () => {
        if (loopPromise) {
          await loopPromise.catch(() => undefined);
        }

        if (options.onClose) {
          await options.onClose();
        }
      })();

      return stopping;
    },
  };
}

function logLoopError(error: unknown): void {
  process.stderr.write(
    `${JSON.stringify({
      event: "scheduler.tick_failed",
      error: error instanceof Error ? error.message : String(error),
      ts: new Date().toISOString(),
    })}\n`,
  );
}
