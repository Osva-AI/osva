export interface EvaluationLaunchDraft {
  readonly evaluationSuiteId: string;
  readonly evaluationSuiteVersionId: string;
  readonly agentId: string;
  readonly agentVersionId: string;
  readonly caseCount: number;
}

export type EvaluationLaunchValidationIssue =
  | { readonly field: "evaluationSuiteId"; readonly message: string }
  | { readonly field: "evaluationSuiteVersionId"; readonly message: string }
  | { readonly field: "agentId"; readonly message: string }
  | { readonly field: "agentVersionId"; readonly message: string }
  | { readonly field: "cases"; readonly message: string };

export function validateEvaluationLaunchDraft(
  draft: EvaluationLaunchDraft,
): readonly EvaluationLaunchValidationIssue[] {
  const issues: EvaluationLaunchValidationIssue[] = [];
  if (draft.evaluationSuiteId.trim().length === 0) {
    issues.push({
      field: "evaluationSuiteId",
      message: "Select an evaluation suite.",
    });
  }
  if (draft.evaluationSuiteVersionId.trim().length === 0) {
    issues.push({
      field: "evaluationSuiteVersionId",
      message: "Select a published suite version.",
    });
  }
  if (draft.agentId.trim().length === 0) {
    issues.push({
      field: "agentId",
      message: "Select an agent.",
    });
  }
  if (draft.agentVersionId.trim().length === 0) {
    issues.push({
      field: "agentVersionId",
      message: "Select an AgentVersion.",
    });
  }
  if (draft.evaluationSuiteVersionId.trim().length > 0 && draft.caseCount < 1) {
    issues.push({
      field: "cases",
      message: "The selected suite version has no test cases.",
    });
  }
  return issues;
}
