import type { RunAttemptId, RunAttemptState, RunId } from "@osva/contracts";
import type { ReconcileEvaluationCase } from "@osva/domain";
import { isTerminalRunAttemptState } from "@osva/domain";

export interface ReconcileEvaluationCaseCommand {
  readonly runId: RunId;
  readonly runAttemptId: RunAttemptId;
  readonly runAttemptStatus: RunAttemptState;
}

export class EvaluationCoordinator {
  constructor(
    private readonly reconcileEvaluationCase: Pick<
      ReconcileEvaluationCase,
      "execute"
    >,
  ) {}

  async reconcileTerminalChildRun(
    command: ReconcileEvaluationCaseCommand,
  ): Promise<void> {
    if (!isTerminalRunAttemptState(command.runAttemptStatus)) {
      return;
    }

    await this.reconcileEvaluationCase.execute({
      runId: command.runId,
      runAttemptId: command.runAttemptId,
    });
  }
}
