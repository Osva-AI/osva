import type { EvaluationCaseResource } from "../hooks/use-evaluations";

export function resolveEvaluationCaseExpected(
  evaluationCase: Pick<EvaluationCaseResource, "expected" | "evaluator">,
): unknown {
  if (evaluationCase.evaluator.type === "JSON_EXACT_MATCH") {
    return evaluationCase.evaluator.expected ?? evaluationCase.expected;
  }
  return evaluationCase.expected;
}

export function uniqueEvaluatorTypes(
  cases: readonly Pick<EvaluationCaseResource, "evaluator">[],
): readonly string[] {
  const types = new Set<string>();
  for (const evaluationCase of cases) {
    types.add(evaluationCase.evaluator.type);
  }
  return [...types].sort();
}
