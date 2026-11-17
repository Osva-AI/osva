import type {
  EvaluationComparisonHumanDecision,
  EvaluationComparisonPairwisePreference,
} from "@osva-ai/contracts";

export interface CalibrationLabelRow {
  readonly judgePreference?: EvaluationComparisonPairwisePreference;
  readonly humanDecision?: EvaluationComparisonHumanDecision;
}

export interface CalibrationReport {
  readonly reviewedPairCount: number;
  readonly eligiblePairedLabelCount: number;
  readonly exactAgreementCount: number;
  readonly agreementRate?: number;
  readonly disagreementCount: number;
  readonly humanUnsureCount: number;
  readonly confusionMatrix: Readonly<
    Record<string, Readonly<Record<string, number>>>
  >;
  readonly unavailableReason?: string;
}

const PREFERENCE_CLASSES = [
  "BASELINE_BETTER",
  "CANDIDATE_BETTER",
  "TIE",
] as const;

export function computeHumanJudgeCalibration(
  rows: readonly CalibrationLabelRow[],
): CalibrationReport {
  const reviewedPairCount = rows.length;
  let eligiblePairedLabelCount = 0;
  let exactAgreementCount = 0;
  let disagreementCount = 0;
  let humanUnsureCount = 0;

  const confusionMatrix: Record<string, Record<string, number>> = {};
  for (const judge of PREFERENCE_CLASSES) {
    confusionMatrix[judge] = {};
    for (const human of [...PREFERENCE_CLASSES, "UNSURE"]) {
      confusionMatrix[judge]![human] = 0;
    }
  }

  for (const row of rows) {
    if (row.humanDecision === "UNSURE") {
      humanUnsureCount += 1;
      continue;
    }
    if (row.judgePreference === undefined || row.humanDecision === undefined) {
      continue;
    }
    eligiblePairedLabelCount += 1;
    confusionMatrix[row.judgePreference]![row.humanDecision] =
      (confusionMatrix[row.judgePreference]![row.humanDecision] ?? 0) + 1;

    if (row.judgePreference === row.humanDecision) {
      exactAgreementCount += 1;
    } else {
      disagreementCount += 1;
    }
  }

  if (eligiblePairedLabelCount === 0) {
    return {
      reviewedPairCount,
      eligiblePairedLabelCount: 0,
      exactAgreementCount: 0,
      disagreementCount: 0,
      humanUnsureCount,
      confusionMatrix,
      unavailableReason: "insufficient_eligible_labels",
    };
  }

  return {
    reviewedPairCount,
    eligiblePairedLabelCount,
    exactAgreementCount,
    agreementRate: exactAgreementCount / eligiblePairedLabelCount,
    disagreementCount,
    humanUnsureCount,
    confusionMatrix,
  };
}
