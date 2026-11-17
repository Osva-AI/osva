import type { EvaluationComparisonId, WorkspaceId } from "@osva-ai/contracts";

import { computeDeterministicComparisonSummary } from "./comparison/deterministic.js";
import { aggregatePairwiseOutcomes } from "./comparison/pairwise-aggregate.js";
import { assessComparisonRegressionAndPromotion } from "./comparison/promotion.js";
import type { EvaluationComparisonApplicationDependencies } from "./evaluation-comparison-application.js";
import { loadEvaluationRunUsageMeasurement } from "./evaluation-run-usage-loader.js";
import { resolveEvaluationRunQualityGate } from "./evaluation-run-quality-gate.js";
import { aggregateEvaluationRunSummary } from "./evaluation-run-scoring.js";

export class ReconcileEvaluationComparison {
  constructor(
    private readonly deps: EvaluationComparisonApplicationDependencies,
  ) {}

  async execute(
    comparisonId: EvaluationComparisonId,
    workspaceId: WorkspaceId,
  ): Promise<void> {
    const comparison =
      await this.deps.comparisons.findComparisonByWorkspaceAndId(
        workspaceId,
        comparisonId,
      );
    if (comparison === null) {
      return;
    }
    if (comparison.status === "FAILED" || comparison.status === "COMPLETED") {
      const pending =
        await this.deps.pairwiseTasks.countNonTerminalPairwiseTasksByComparison(
          comparisonId,
        );
      if (pending === 0) {
        return;
      }
    }

    const suiteVersion = await this.deps.evaluationSuites.findSuiteVersionById(
      comparison.evaluationSuiteVersionId,
    );
    if (suiteVersion === null) {
      return;
    }

    const baselineResults =
      await this.deps.evaluationSuites.listCaseResultsByEvaluationRun(
        comparison.baselineEvaluationRunId,
      );
    const candidateResults =
      await this.deps.evaluationSuites.listCaseResultsByEvaluationRun(
        comparison.candidateEvaluationRunId,
      );

    const deterministic = computeDeterministicComparisonSummary({
      cases: suiteVersion.cases.map((c) => ({ id: c.id, key: c.key })),
      baselineResults,
      candidateResults,
    });

    const pairwiseEnabled = comparison.pairwiseConfig?.enabled === true;
    const pending =
      await this.deps.pairwiseTasks.countNonTerminalPairwiseTasksByComparison(
        comparisonId,
      );

    let pairwiseSummary:
      | import("@osva-ai/contracts").EvaluationComparisonPairwiseSummaryV1
      | undefined;
    if (!pairwiseEnabled) {
      pairwiseSummary = undefined;
    } else if (pending > 0) {
      pairwiseSummary = {
        schemaVersion: 1,
        enabled: true,
        validJudgmentCount: 0,
        incompleteJudgmentCount: pending,
        baselineWins: 0,
        candidateWins: 0,
        ties: 0,
        positionDisagreementCount: 0,
        coverage: 0,
        caseResults: [],
      };
    } else {
      pairwiseSummary = await this.buildPairwiseSummary(
        comparisonId,
        suiteVersion.cases.map((c) => c.id),
      );
    }

    const baseline = await this.deps.evaluationSuites.findEvaluationRunById(
      comparison.baselineEvaluationRunId,
    );
    const candidate = await this.deps.evaluationSuites.findEvaluationRunById(
      comparison.candidateEvaluationRunId,
    );
    if (baseline === null || candidate === null) {
      return;
    }

    const now = this.deps.clock.now();
    const baselineSummary = aggregateEvaluationRunSummary(
      suiteVersion.cases.length,
      baselineResults,
      await loadEvaluationRunUsageMeasurement(
        this.deps.runs,
        workspaceId,
        baseline,
        baselineResults,
      ),
    );
    const candidateSummary = aggregateEvaluationRunSummary(
      suiteVersion.cases.length,
      candidateResults,
      await loadEvaluationRunUsageMeasurement(
        this.deps.runs,
        workspaceId,
        candidate,
        candidateResults,
      ),
    );
    const qualityGateDeps: import("./evaluation-run-application.js").EvaluationRunApplicationDependencies =
      {
        evaluationSuites: this.deps.evaluationSuites,
        runs: this.deps.runs,
        agents: {} as never,
        queue: {} as never,
        clock: this.deps.clock,
        ids: this.deps.ids,
      };
    const baselineGate = await resolveEvaluationRunQualityGate(
      qualityGateDeps,
      baseline,
      baselineSummary,
      now,
    );
    const candidateGate = await resolveEvaluationRunQualityGate(
      qualityGateDeps,
      candidate,
      candidateSummary,
      now,
    );

    const baselineUsage = await loadEvaluationRunUsageMeasurement(
      this.deps.runs,
      workspaceId,
      baseline,
      baselineResults,
    );
    const candidateUsage = await loadEvaluationRunUsageMeasurement(
      this.deps.runs,
      workspaceId,
      candidate,
      candidateResults,
    );

    const pairwiseCost = await this.sumPairwiseJudgeCost(comparisonId);

    const costSummary = {
      baselinePricedCostUsdMicros: baselineUsage.pricedCostUsdMicros,
      candidatePricedCostUsdMicros: candidateUsage.pricedCostUsdMicros,
      pairwisePricedCostUsdMicros: pairwiseCost.priced,
      totalKnownCostUsdMicros:
        baselineUsage.pricedCostUsdMicros +
        candidateUsage.pricedCostUsdMicros +
        pairwiseCost.priced,
      unpricedModelCalls:
        baselineUsage.unpricedModelCalls +
        candidateUsage.unpricedModelCalls +
        pairwiseCost.unpriced,
      usageMeasured:
        baselineUsage.usageMeasured &&
        candidateUsage.usageMeasured &&
        pairwiseCost.unpriced === 0,
    };

    const { regression, promotion } = assessComparisonRegressionAndPromotion({
      policy: comparison.policySnapshot,
      deterministic,
      pairwise: pairwiseSummary,
      cost: costSummary,
      baselineQualityGateVerdict: baselineGate?.assessment?.overallVerdict,
      candidateQualityGateVerdict: candidateGate?.assessment?.overallVerdict,
      assessedAt: now,
    });

    const pendingPairwise = pairwiseEnabled && pending > 0;
    const status = pendingPairwise
      ? "RUNNING"
      : promotion.recommendation === "BLOCK"
        ? "FAILED"
        : "COMPLETED";

    const updated = comparison.withUpdatedAssessment({
      deterministicSummary: deterministic,
      pairwiseSummary,
      regressionAssessment: regression,
      promotion,
      costSummary,
      status,
      updatedAt: now,
    });

    await this.deps.comparisons.saveComparison(updated);
  }

  private async buildPairwiseSummary(
    comparisonId: EvaluationComparisonId,
    caseIds: readonly import("@osva-ai/contracts").EvaluationCaseId[],
  ) {
    const comparison =
      await this.deps.comparisons.findComparisonById(comparisonId);
    if (comparison === null) {
      throw new Error("comparison_not_found");
    }
    const tasks =
      await this.deps.pairwiseTasks.listSucceededPairwiseTasksByComparison(
        comparisonId,
      );

    const outcomes = tasks.map((task) => ({
      evaluationCaseId: task.evaluationCaseId,
      position: task.judgmentPosition,
      preference:
        typeof task.terminalResult?.verdict?.canonicalPreference === "string"
          ? (task.terminalResult.verdict
              .canonicalPreference as import("@osva-ai/contracts").EvaluationComparisonPairwisePreference)
          : undefined,
      errorCode: task.status === "FAILED" ? task.errorCode : undefined,
    }));

    return aggregatePairwiseOutcomes({
      enabled: true,
      requireReversedJudgments:
        comparison.pairwiseConfig?.mitigatePositionBias === true,
      caseIds,
      outcomes,
    });
  }

  private async sumPairwiseJudgeCost(comparisonId: EvaluationComparisonId) {
    const tasks =
      await this.deps.pairwiseTasks.listSucceededPairwiseTasksByComparison(
        comparisonId,
      );
    let priced = 0;
    let unpriced = 0;
    for (const task of tasks) {
      const accounting = task.terminalResult?.judgeUsageAccounting as
        | { pricedCostUsdMicros?: number; unpricedModelCalls?: number }
        | undefined;
      priced += accounting?.pricedCostUsdMicros ?? 0;
      unpriced += accounting?.unpricedModelCalls ?? 0;
    }
    return { priced, unpriced };
  }
}
