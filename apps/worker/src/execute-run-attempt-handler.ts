import type { JobQueueHandler } from "@osva/contracts";
import type { ExecuteRunAttempt } from "@osva/orchestration";

export interface ExecutionClock {
  now(): Date;
}

export function createExecuteRunAttemptHandler(
  executeRunAttempt: Pick<ExecuteRunAttempt, "execute">,
  clock: ExecutionClock,
): JobQueueHandler {
  return async (payload) => {
    await executeRunAttempt.execute({
      runAttemptId: payload.runAttemptId,
      now: clock.now(),
    });
  };
}
