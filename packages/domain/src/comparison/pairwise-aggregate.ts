import type {
  EvaluationCaseId,
  EvaluationComparisonPairwiseCaseResultV1,
  EvaluationComparisonPairwisePreference,
  EvaluationComparisonPairwiseSummaryV1,
} from "@osva-ai/contracts";

export interface PairwiseTaskOutcome {
  readonly evaluationCaseId: EvaluationCaseId;
  readonly position: "PRIMARY" | "REVERSED";
  readonly preference?: EvaluationComparisonPairwisePreference;
  readonly errorCode?: string;
}

export function aggregatePairwiseOutcomes(input: {
  readonly enabled: boolean;
  readonly requireReversedJudgments: boolean;
  readonly caseIds: readonly EvaluationCaseId[];
  readonly outcomes: readonly PairwiseTaskOutcome[];
}): EvaluationComparisonPairwiseSummaryV1 {
  const byCase = new Map<
    string,
    {
      primary?: EvaluationComparisonPairwisePreference;
      reversed?: EvaluationComparisonPairwisePreference;
      errors: number;
    }
  >();

  for (const caseId of input.caseIds) {
    byCase.set(caseId, { errors: 0 });
  }

  for (const outcome of input.outcomes) {
    const row = byCase.get(outcome.evaluationCaseId) ?? { errors: 0 };
    if (outcome.errorCode !== undefined || outcome.preference === undefined) {
      row.errors += 1;
    } else if (outcome.position === "PRIMARY") {
      row.primary = outcome.preference;
    } else {
      row.reversed = outcome.preference;
    }
    byCase.set(outcome.evaluationCaseId, row);
  }

  const caseResults: EvaluationComparisonPairwiseCaseResultV1[] = [];
  let validJudgmentCount = 0;
  let incompleteJudgmentCount = 0;
  let baselineWins = 0;
  let candidateWins = 0;
  let ties = 0;
  let positionDisagreementCount = 0;

  for (const caseId of input.caseIds) {
    const row = byCase.get(caseId)!;
    let canonical: EvaluationComparisonPairwisePreference | undefined;
    let positionDisagreement = false;

    if (row.primary !== undefined) {
      if (row.reversed === undefined) {
        if (input.requireReversedJudgments) {
          incompleteJudgmentCount += 1;
        } else {
          canonical = row.primary;
        }
      } else if (row.reversed === row.primary) {
        canonical = row.primary;
      } else {
        positionDisagreement = true;
        positionDisagreementCount += 1;
        canonical = undefined;
        incompleteJudgmentCount += 1;
      }
    } else {
      incompleteJudgmentCount += 1;
    }

    if (canonical !== undefined && !positionDisagreement) {
      validJudgmentCount += 1;
      if (canonical === "BASELINE_BETTER") {
        baselineWins += 1;
      } else if (canonical === "CANDIDATE_BETTER") {
        candidateWins += 1;
      } else {
        ties += 1;
      }
    }

    caseResults.push({
      evaluationCaseId: caseId,
      ...(row.primary === undefined ? {} : { primaryPreference: row.primary }),
      ...(row.reversed === undefined
        ? {}
        : { reversedPreference: row.reversed }),
      ...(canonical === undefined ? {} : { canonicalPreference: canonical }),
      positionDisagreement,
      incomplete: canonical === undefined,
      ...(row.errors > 0 ? { errorCode: "pairwise_judgment_error" } : {}),
    });
  }

  const decided = baselineWins + candidateWins + ties;
  return {
    schemaVersion: 1,
    enabled: input.enabled,
    validJudgmentCount,
    incompleteJudgmentCount,
    baselineWins,
    candidateWins,
    ties,
    positionDisagreementCount,
    coverage:
      input.caseIds.length === 0
        ? 0
        : validJudgmentCount / input.caseIds.length,
    candidateWinRate: decided === 0 ? undefined : candidateWins / decided,
    baselineWinRate: decided === 0 ? undefined : baselineWins / decided,
    tieRate: decided === 0 ? undefined : ties / decided,
    caseResults,
  };
}
