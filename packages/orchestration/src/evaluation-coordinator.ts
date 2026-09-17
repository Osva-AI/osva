import type { RunAttemptId, RunAttemptState, RunId } from "@osva/contracts";
import type { ReconcileEvaluationCase } from "@osva/domain";
import { isTerminalRunAttemptState } from "@osva/domain";
import {
  OSVA_ATTR,
  OSVA_METRIC,
  OSVA_SPAN,
  resolveInstrumentation,
  type OsvaInstrumentation,
} from "@osva/observability";

export interface ReconcileEvaluationCaseCommand {
  readonly runId: RunId;
  readonly runAttemptId: RunAttemptId;
  readonly runAttemptStatus: RunAttemptState;
}

export interface EvaluationCoordinatorDependencies {
  readonly reconcileEvaluationCase: Pick<ReconcileEvaluationCase, "execute">;
  readonly instrumentation?: OsvaInstrumentation;
}

export class EvaluationCoordinator {
  constructor(private readonly deps: EvaluationCoordinatorDependencies) {}

  async reconcileTerminalChildRun(
    command: ReconcileEvaluationCaseCommand,
  ): Promise<void> {
    if (!isTerminalRunAttemptState(command.runAttemptStatus)) {
      return;
    }

    const telemetry = resolveInstrumentation(this.deps.instrumentation);

    await telemetry.withSpan(
      OSVA_SPAN.EVALUATION_RECONCILE,
      {
        [OSVA_ATTR.RUN_ID]: command.runId,
        [OSVA_ATTR.RUN_ATTEMPT_ID]: command.runAttemptId,
      },
      async () => {
        await this.deps.reconcileEvaluationCase.execute({
          runId: command.runId,
          runAttemptId: command.runAttemptId,
        });
        telemetry.recordCounter(OSVA_METRIC.EVALUATION_RECONCILIATIONS, 1);
      },
    );
  }
}
