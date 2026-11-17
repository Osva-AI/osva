import { createHash } from "node:crypto";

import type {
  EvaluationComparisonPairwiseConfigV1,
  EvaluationComparisonPolicyV1,
  EvaluationSuiteVersionId,
} from "@osva-ai/contracts";
import { EVALUATION_COMPARISON_PAIRWISE_PROMPT_TEMPLATE_VERSION } from "@osva-ai/contracts";

export function computePairwiseRubricIdentity(input: {
  readonly evaluationSuiteVersionId: EvaluationSuiteVersionId;
  readonly policy: EvaluationComparisonPolicyV1;
  readonly pairwise: EvaluationComparisonPairwiseConfigV1;
}): string {
  const payload = JSON.stringify({
    evaluationSuiteVersionId: input.evaluationSuiteVersionId,
    policySchemaVersion: input.policy.schemaVersion,
    pairwiseSchemaVersion: input.pairwise.schemaVersion,
    rubric: input.pairwise.rubric,
    modelProfileVersionId: input.pairwise.modelProfileVersionId,
    instructions: input.pairwise.instructions ?? null,
    mitigatePositionBias: input.pairwise.mitigatePositionBias ?? false,
    promptTemplateVersion:
      EVALUATION_COMPARISON_PAIRWISE_PROMPT_TEMPLATE_VERSION,
  });
  return createHash("sha256").update(payload, "utf8").digest("hex");
}
