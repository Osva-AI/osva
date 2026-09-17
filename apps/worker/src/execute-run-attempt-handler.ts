import type { JobQueueHandler } from "@osva/contracts";
import type {
  EvaluationCoordinator,
  ExecuteRunAttempt,
} from "@osva/orchestration";

export interface ExecutionClock {
  now(): Date;
}

export function createExecuteRunAttemptHandler(
  executeRunAttempt: Pick<ExecuteRunAttempt, "execute">,
  clock: ExecutionClock,
  evaluationCoordinator?: Pick<
    EvaluationCoordinator,
    "reconcileTerminalChildRun"
  >,
): JobQueueHandler {
  return async (payload) => {
    const result = await executeRunAttempt.execute({
      runAttemptId: payload.runAttemptId,
      now: clock.now(),
    });

    if (evaluationCoordinator === undefined) {
      return;
    }

    if (
      result.outcome === "succeeded" ||
      result.outcome === "failed" ||
      result.outcome === "already-terminal"
    ) {
      await evaluationCoordinator.reconcileTerminalChildRun({
        runId: result.run.id,
        runAttemptId: result.runAttempt.id,
        runAttemptStatus: result.runAttempt.status,
      });
    }
  };
}
