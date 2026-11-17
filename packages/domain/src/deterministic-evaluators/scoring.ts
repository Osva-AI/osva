import type { EvaluationCaseOutcome } from "@osva-ai/contracts";

export function scoreFromEvaluatorResults(
  outcome: EvaluationCaseOutcome,
  evaluatorResults: Readonly<Record<string, unknown>>,
): number | null {
  if (outcome === "ERROR") {
    return null;
  }
  const score = evaluatorResults.score;
  if (
    typeof score === "number" &&
    Number.isFinite(score) &&
    score >= 0 &&
    score <= 1
  ) {
    return score;
  }
  if (outcome === "PASS") {
    return 1;
  }
  if (outcome === "FAIL") {
    return 0;
  }
  return null;
}
