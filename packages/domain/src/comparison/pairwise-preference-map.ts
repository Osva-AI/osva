import type {
  EvaluationComparisonPairwiseJudgmentPosition,
  EvaluationComparisonPairwisePreference,
} from "@osva-ai/contracts";

export const AB_PAIRWISE_SLOT_PREFERENCES = [
  "A_BETTER",
  "B_BETTER",
  "TIE",
] as const;

export type AbPairwiseSlotPreference =
  (typeof AB_PAIRWISE_SLOT_PREFERENCES)[number];

export function mapAbPreferenceToCanonical(
  judgmentPosition: EvaluationComparisonPairwiseJudgmentPosition,
  slotPreference: AbPairwiseSlotPreference,
): EvaluationComparisonPairwisePreference {
  if (slotPreference === "TIE") {
    return "TIE";
  }
  if (judgmentPosition === "PRIMARY") {
    return slotPreference === "A_BETTER"
      ? "BASELINE_BETTER"
      : "CANDIDATE_BETTER";
  }
  return slotPreference === "A_BETTER" ? "CANDIDATE_BETTER" : "BASELINE_BETTER";
}
