import type { EvaluationRunId, WorkspaceId } from "@osva-ai/contracts";
import type { AgentVersionId } from "@osva-ai/contracts";

import type { EvaluationRunApplicationDependencies } from "./evaluation-run-application.js";
import { ensureEvaluationLaunchMaterialized } from "./evaluation-run-launch.js";
import {
  buildEvaluationRunSummaryForRun,
  persistTerminalEvaluationRunGateAssessment,
} from "./evaluation-run-quality-gate.js";
import {
  reconcileCaseResultsForScoring,
  type EvaluationRunSummary,
} from "./evaluation-run-scoring.js";
import { TERMINAL_EVALUATION_RUN_STATES } from "./evaluation-run-state-machine.js";
import { isTerminalRunAttemptState } from "./run-attempt-state-machine.js";
import { runtimeControlPlaneScope } from "./control-plane.js";
import type { EvaluationRun } from "./evaluation-run.js";
import type { ReconcileEvaluationCase } from "./evaluation-run-application.js";

export const DEFAULT_EVALUATION_RECOVERY_BATCH_LIMIT = 20;

export interface RecoverEvaluationRunsCommand {
  readonly batchLimit?: number;
}

export interface EvaluationRecoveryLogger {
  info(event: string, fields?: Readonly<Record<string, unknown>>): void;
  error(event: string, fields?: Readonly<Record<string, unknown>>): void;
}

export class RecoverEvaluationRuns {
  constructor(
    private readonly deps: EvaluationRunApplicationDependencies & {
      readonly reconcileEvaluationCase: Pick<
        ReconcileEvaluationCase,
        "execute"
      >;
      readonly logger?: EvaluationRecoveryLogger;
    },
  ) {}

  async execute(command: RecoverEvaluationRunsCommand = {}): Promise<number> {
    const limit = command.batchLimit ?? DEFAULT_EVALUATION_RECOVERY_BATCH_LIMIT;
    const candidates =
      await this.deps.evaluationSuites.listEvaluationRunsForRecovery(limit);

    const gateCandidates =
      await this.deps.evaluationSuites.listTerminalEvaluationRunsMissingGateAssessment(
        limit,
      );

    const seen = new Set<string>();
    const toProcess: EvaluationRun[] = [];
    for (const evaluationRun of [...candidates, ...gateCandidates]) {
      if (seen.has(evaluationRun.id)) {
        continue;
      }
      seen.add(evaluationRun.id);
      toProcess.push(evaluationRun);
    }

    let recovered = 0;
    for (const evaluationRun of toProcess) {
      try {
        const touched = await this.recoverOne(evaluationRun);
        if (touched) {
          recovered += 1;
        }
      } catch (error) {
        this.deps.logger?.error("evaluation.recovery.failed", {
          evaluationRunId: evaluationRun.id,
          error: error instanceof Error ? error.message : "unknown_error",
        });
      }
    }
    return recovered;
  }

  private async recoverOne(evaluationRun: EvaluationRun): Promise<boolean> {
    if (evaluationRun.status === "CANCELLED") {
      return false;
    }

    const now = this.deps.clock.now();
    const suiteVersion = await this.deps.evaluationSuites.findSuiteVersionById(
      evaluationRun.evaluationSuiteVersionId,
    );
    if (suiteVersion === null) {
      return false;
    }

    this.deps.logger?.info("evaluation.recovery.attempt", {
      evaluationRunId: evaluationRun.id,
      status: evaluationRun.status,
    });

    await ensureEvaluationLaunchMaterialized(
      this.deps,
      evaluationRun,
      suiteVersion,
      evaluationRun.targetVersionId as AgentVersionId,
      now,
    );

    await this.reconcileMissingCaseResults(
      evaluationRun.workspaceId,
      evaluationRun.id,
    );

    await reconcileParentTerminalState(
      this.deps,
      evaluationRun.id,
      suiteVersion.cases.length,
      now,
    );

    await recoverEvaluationRunQualityGate(
      this.deps,
      evaluationRun.workspaceId,
      evaluationRun.id,
      suiteVersion.cases.length,
      now,
    );

    return true;
  }

  private async reconcileMissingCaseResults(
    workspaceId: WorkspaceId,
    evaluationRunId: EvaluationRunId,
  ): Promise<void> {
    const childRuns = await this.deps.runs.listRunsByEvaluationRunId(
      workspaceId,
      evaluationRunId,
    );

    for (const childRun of childRuns) {
      if (childRun.evaluationCaseId === undefined) {
        continue;
      }

      const existing =
        await this.deps.evaluationSuites.findCaseResultByRunAndCase(
          evaluationRunId,
          childRun.evaluationCaseId,
        );
      if (existing !== null) {
        continue;
      }

      const attempts = await this.deps.runs.listRunAttempts(childRun.id);
      const terminalAttempts = attempts
        .filter((attempt) => isTerminalRunAttemptState(attempt.status))
        .sort((left, right) => right.sequence - left.sequence);
      const latestTerminal = terminalAttempts[0];
      if (latestTerminal === undefined) {
        continue;
      }

      await this.deps.reconcileEvaluationCase.execute(
        runtimeControlPlaneScope(workspaceId),
        {
          runId: childRun.id,
          runAttemptId: latestTerminal.id,
        },
      );
    }
  }
}

export async function reconcileParentTerminalState(
  deps: EvaluationRunApplicationDependencies,
  evaluationRunId: EvaluationRunId,
  totalCases: number,
  now: Date,
): Promise<void> {
  const evaluationRun =
    await deps.evaluationSuites.findEvaluationRunById(evaluationRunId);
  if (
    evaluationRun === null ||
    (TERMINAL_EVALUATION_RUN_STATES as readonly string[]).includes(
      evaluationRun.status,
    )
  ) {
    return;
  }

  const caseResults =
    await deps.evaluationSuites.listCaseResultsByEvaluationRun(evaluationRunId);
  const reconciled = reconcileCaseResultsForScoring(caseResults);

  if (reconciled.length < totalCases) {
    return;
  }

  if (deps.judgeTasks !== undefined) {
    const pendingJudgeTasks =
      await deps.judgeTasks.countNonTerminalJudgeTasksByRun(evaluationRunId);
    if (pendingJudgeTasks > 0) {
      return;
    }
  }

  const hasError = reconciled.some((result) => result.outcome === "ERROR");
  const nextStatus = hasError ? "FAILED" : "COMPLETED";
  const next = evaluationRun.transitionTo(nextStatus, {
    updatedAt: now,
    completedAt: now,
  });

  try {
    await deps.evaluationSuites.transitionEvaluationRun(
      evaluationRun.status,
      next,
    );
  } catch {
    const latest =
      await deps.evaluationSuites.findEvaluationRunById(evaluationRunId);
    if (latest?.status === nextStatus) {
      return;
    }
    throw new Error(
      `EvaluationRun '${evaluationRunId}' terminal transition conflict.`,
    );
  }
}

async function recoverQualityGateIfNeeded(
  workspaceId: WorkspaceId,
  evaluationRunId: EvaluationRunId,
  totalCases: number,
  now: Date,
  deps: EvaluationRunApplicationDependencies,
): Promise<void> {
  const evaluationRun =
    await deps.evaluationSuites.findEvaluationRunById(evaluationRunId);
  if (
    evaluationRun === null ||
    evaluationRun.qualityGatePolicy === undefined ||
    !(TERMINAL_EVALUATION_RUN_STATES as readonly string[]).includes(
      evaluationRun.status,
    )
  ) {
    return;
  }

  const stored =
    await deps.evaluationSuites.findGateAssessmentByWorkspaceAndEvaluationRunId(
      workspaceId,
      evaluationRunId,
    );
  if (stored !== null) {
    return;
  }

  const summary: EvaluationRunSummary = await buildEvaluationRunSummaryForRun(
    deps,
    workspaceId,
    evaluationRun,
    totalCases,
  );

  await persistTerminalEvaluationRunGateAssessment(
    deps,
    evaluationRun,
    summary,
    now,
  );
}

export async function recoverEvaluationRunQualityGate(
  deps: EvaluationRunApplicationDependencies,
  workspaceId: WorkspaceId,
  evaluationRunId: EvaluationRunId,
  totalCases: number,
  now: Date,
): Promise<void> {
  await recoverQualityGateIfNeeded(
    workspaceId,
    evaluationRunId,
    totalCases,
    now,
    deps,
  );
}
