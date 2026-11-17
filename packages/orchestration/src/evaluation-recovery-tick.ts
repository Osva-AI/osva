import {
  RecoverEvaluationRuns,
  type EvaluationRecoveryLogger,
  DEFAULT_EVALUATION_RECOVERY_BATCH_LIMIT,
} from "@osva/domain";
import type { JudgeTaskRecoveryCoordinator } from "./judge-task-recovery-coordinator.js";
import type { PairwiseTaskRecoveryCoordinator } from "./pairwise-task-recovery-coordinator.js";
import type { ReconcileEvaluationCase } from "@osva/domain";
import type { EvaluationRunApplicationDependencies } from "@osva/domain";
import {
  elapsedMs,
  OSVA_METRIC,
  OSVA_SPAN,
  resolveInstrumentation,
  type OsvaInstrumentation,
} from "@osva/observability";

export interface EvaluationRecoveryTickDependencies extends EvaluationRunApplicationDependencies {
  readonly reconcileEvaluationCase: Pick<ReconcileEvaluationCase, "execute">;
  readonly judgeTaskCoordinator?: JudgeTaskRecoveryCoordinator;
  readonly pairwiseTaskCoordinator?: PairwiseTaskRecoveryCoordinator;
  readonly batchLimit?: number;
  readonly instrumentation?: OsvaInstrumentation;
  readonly logger?: EvaluationRecoveryLogger;
}

export class EvaluationRecoveryTick {
  private readonly batchLimit: number;

  constructor(private readonly deps: EvaluationRecoveryTickDependencies) {
    this.batchLimit =
      deps.batchLimit ?? DEFAULT_EVALUATION_RECOVERY_BATCH_LIMIT;
  }

  async execute(): Promise<void> {
    const telemetry = resolveInstrumentation(this.deps.instrumentation);
    const startedAt = performance.now();
    const recover = new RecoverEvaluationRuns({
      ...this.deps,
      logger: this.deps.logger,
    });

    await telemetry.withSpan(
      OSVA_SPAN.EXECUTION_RECOVERY,
      undefined,
      async () => {
        const count = await recover.execute({ batchLimit: this.batchLimit });
        if (count > 0) {
          telemetry.recordCounter(
            OSVA_METRIC.RECOVERY_TRANSPORT_REPAIRED,
            count,
            {
              kind: "evaluation",
            },
          );
        }

        if (this.deps.judgeTaskCoordinator !== undefined) {
          this.deps.judgeTaskCoordinator.schedule();
        }
        if (this.deps.pairwiseTaskCoordinator !== undefined) {
          this.deps.pairwiseTaskCoordinator.schedule();
        }
      },
    );

    telemetry.recordHistogram(
      OSVA_METRIC.RECOVERY_DURATION_MS,
      elapsedMs(startedAt, performance.now()),
      { kind: "evaluation" },
    );
  }
}
