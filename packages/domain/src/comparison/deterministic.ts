import type {
  EvaluationCaseId,
  EvaluationCaseOutcome,
  EvaluationComparisonCasePairV1,
  EvaluationComparisonDeterministicSummaryV1,
} from "@osva-ai/contracts";

import { scoreFromEvaluatorResults } from "../deterministic-evaluators/scoring.js";
import {
  meanNormalizedQualityScore,
  reconcileCaseResultsForScoring,
  type EvaluationCaseResultForScoring,
} from "../evaluation-run-scoring.js";

export interface ComparisonSuiteCase {
  readonly id: EvaluationCaseId;
  readonly key: string;
}

export interface AlignedComparisonInput {
  readonly cases: readonly ComparisonSuiteCase[];
  readonly baselineResults: readonly EvaluationCaseResultForScoring[];
  readonly candidateResults: readonly EvaluationCaseResultForScoring[];
}

const SCORE_EPSILON = 1e-9;

export function computeDeterministicComparisonSummary(
  input: AlignedComparisonInput,
): EvaluationComparisonDeterministicSummaryV1 {
  const baselineByCase = indexResultsByCaseId(input.baselineResults);
  const candidateByCase = indexResultsByCaseId(input.candidateResults);

  const casePairs: EvaluationComparisonCasePairV1[] = [];
  let validScoredPairCount = 0;
  let missingOrErrorPairCount = 0;
  let improvedCaseCount = 0;
  let regressedCaseCount = 0;
  let unchangedCaseCount = 0;
  let pairedDeltaSum = 0;

  const baselineScoresForMean: number[] = [];
  const candidateScoresForMean: number[] = [];

  for (const evaluationCase of input.cases) {
    const baseline = baselineByCase.get(evaluationCase.id);
    const candidate = candidateByCase.get(evaluationCase.id);
    const baselineScore = scoreForResult(baseline);
    const candidateScore = scoreForResult(candidate);
    const evidenceIncomplete =
      baseline === undefined ||
      candidate === undefined ||
      baselineScore === null ||
      candidateScore === null;

    let scoreDelta: number | undefined;
    let regressionDetected = false;
    let improvementDetected = false;

    if (
      !evidenceIncomplete &&
      baselineScore !== null &&
      candidateScore !== null
    ) {
      scoreDelta = candidateScore - baselineScore;
      validScoredPairCount += 1;
      pairedDeltaSum += scoreDelta;
      if (scoreDelta > SCORE_EPSILON) {
        improvementDetected = true;
        improvedCaseCount += 1;
      } else if (scoreDelta < -SCORE_EPSILON) {
        regressionDetected = true;
        regressedCaseCount += 1;
      } else {
        unchangedCaseCount += 1;
      }
    } else {
      missingOrErrorPairCount += 1;
    }

    if (baselineScore !== null) {
      baselineScoresForMean.push(baselineScore);
    }
    if (candidateScore !== null) {
      candidateScoresForMean.push(candidateScore);
    }

    casePairs.push({
      evaluationCaseId: evaluationCase.id,
      caseKey: evaluationCase.key,
      baselineOutcome: baseline?.outcome,
      candidateOutcome: candidate?.outcome,
      ...(baselineScore === null ? {} : { baselineScore }),
      ...(candidateScore === null ? {} : { candidateScore }),
      ...(scoreDelta === undefined ? {} : { scoreDelta }),
      regressionDetected,
      improvementDetected,
      evidenceIncomplete,
      ...(baseline === undefined ? {} : { baselineResultId: baseline.id }),
      ...(candidate === undefined ? {} : { candidateResultId: candidate.id }),
    });
  }

  return {
    schemaVersion: 1,
    pairedCaseCount: input.cases.length,
    validScoredPairCount,
    missingOrErrorPairCount,
    baselineQualityScore: meanNormalizedQualityScore(baselineScoresForMean),
    candidateQualityScore: meanNormalizedQualityScore(candidateScoresForMean),
    meanPairedScoreDelta:
      validScoredPairCount === 0
        ? undefined
        : pairedDeltaSum / validScoredPairCount,
    improvedCaseCount,
    regressedCaseCount,
    unchangedCaseCount,
    baselineOnlyMeanQualityScore: meanNormalizedQualityScore(
      baselineScoresForMean,
    ),
    candidateOnlyMeanQualityScore: meanNormalizedQualityScore(
      candidateScoresForMean,
    ),
    casePairs,
  };
}

function indexResultsByCaseId<T extends EvaluationCaseResultForScoring>(
  results: readonly T[],
): Map<string, T> {
  const reconciled = reconcileCaseResultsForScoring(results);
  const map = new Map<string, T>();
  for (const result of reconciled) {
    map.set(result.evaluationCaseId, result as T);
  }
  return map;
}

function scoreForResult(
  result: EvaluationCaseResultForScoring | undefined,
): number | null {
  if (result === undefined) {
    return null;
  }
  if (result.evaluatorResults !== undefined) {
    return scoreFromEvaluatorResults(
      result.outcome as EvaluationCaseOutcome,
      result.evaluatorResults,
    );
  }
  if (result.outcome === "PASS") {
    return 1;
  }
  if (result.outcome === "FAIL") {
    return 0;
  }
  return null;
}
