export type WorkflowOrchestratorStatus = "created" | "running" | "stopped";

export type WorkflowOrchestratorReadinessCheck = () => Promise<void>;

export interface CreateWorkflowOrchestratorApplicationOptions {
  readonly readinessCheck: WorkflowOrchestratorReadinessCheck;
  readonly onTick: () => Promise<void>;
  readonly pollMs: number;
  readonly onClose?: () => Promise<void>;
}

export interface WorkflowOrchestratorApplication {
  start(): Promise<void>;
  stop(): Promise<void>;
  status(): WorkflowOrchestratorStatus;
  tickOnce(): Promise<void>;
}

export function createWorkflowOrchestratorApplication(
  options: CreateWorkflowOrchestratorApplicationOptions,
): WorkflowOrchestratorApplication {
  let status: WorkflowOrchestratorStatus = "created";
  let stopping: Promise<void> | undefined;
  let loopPromise: Promise<void> | undefined;
  let stopped = false;

  const sleep = (ms: number) =>
    new Promise<void>((resolve) => setTimeout(resolve, ms));

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
        throw new Error("Workflow orchestrator has already stopped.");
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
      event: "workflow_orchestrator.tick_failed",
      error: error instanceof Error ? error.message : String(error),
      ts: new Date().toISOString(),
    })}\n`,
  );
}
