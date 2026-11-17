import { z } from "zod";

import {
  EVALUATION_COMPARISON_CRITICAL_CASE_IDS_MAX,
  EVALUATION_COMPARISON_HUMAN_DECISIONS,
  EVALUATION_COMPARISON_HUMAN_RATIONALE_MAX_LENGTH,
  EVALUATION_COMPARISON_PAIRWISE_CONFIG_SCHEMA_VERSION,
  EVALUATION_COMPARISON_PAIRWISE_INSTRUCTIONS_MAX_LENGTH,
  EVALUATION_COMPARISON_PAIRWISE_PREFERENCES,
  EVALUATION_COMPARISON_PAIRWISE_RUBRIC_MAX_LENGTH,
  EVALUATION_COMPARISON_POLICY_SCHEMA_VERSION,
  EVALUATION_COMPARISON_PROMOTION_RECOMMENDATIONS,
} from "../evaluation-comparison.js";
import {
  LLM_JUDGE_MAX_OUTPUT_TOKENS_MAX,
  LLM_JUDGE_MAX_OUTPUT_TOKENS_MIN,
} from "../evaluation.js";
import { EVALUATION_COMPARISON_STATES } from "../evaluation-comparison.js";
import {
  evaluationCaseIdSchema,
  evaluationComparisonIdSchema,
  evaluationRunIdSchema,
  evaluationSuiteVersionIdSchema,
  modelProfileVersionIdSchema,
  userIdSchema,
} from "./ids.js";

const unitIntervalSchema = z
  .number()
  .min(0)
  .max(1)
  .refine((v) => Number.isFinite(v));

const nonnegativeIntSchema = z.int().min(0);

export const evaluationComparisonPolicyV1Schema = z.strictObject({
  schemaVersion: z.literal(EVALUATION_COMPARISON_POLICY_SCHEMA_VERSION),
  minComparisonCoverage: unitIntervalSchema,
  minValidScoredPairs: z.int().min(1).max(10_000),
  maxMeanPairedScoreRegression: unitIntervalSchema,
  maxPerCaseScoreRegression: unitIntervalSchema,
  maxNewlyFailingCriticalCases: nonnegativeIntSchema,
  maxNewEvaluatorErrors: nonnegativeIntSchema,
  criticalCaseIds: z
    .array(evaluationCaseIdSchema)
    .max(EVALUATION_COMPARISON_CRITICAL_CASE_IDS_MAX)
    .optional(),
  minCandidatePairwiseWinRate: unitIntervalSchema.optional(),
  maxTotalKnownCostUsdMicros: z.int().min(0).optional(),
  requireCompleteTotalCost: z.boolean().optional(),
});

export const evaluationComparisonPairwiseConfigV1Schema = z
  .strictObject({
    schemaVersion: z.literal(
      EVALUATION_COMPARISON_PAIRWISE_CONFIG_SCHEMA_VERSION,
    ),
    enabled: z.boolean(),
    rubric: z
      .string()
      .min(1)
      .max(EVALUATION_COMPARISON_PAIRWISE_RUBRIC_MAX_LENGTH),
    modelProfileVersionId: modelProfileVersionIdSchema,
    maxOutputTokens: z
      .int()
      .min(LLM_JUDGE_MAX_OUTPUT_TOKENS_MIN)
      .max(LLM_JUDGE_MAX_OUTPUT_TOKENS_MAX)
      .optional(),
    instructions: z
      .string()
      .min(1)
      .max(EVALUATION_COMPARISON_PAIRWISE_INSTRUCTIONS_MAX_LENGTH)
      .optional(),
    mitigatePositionBias: z.boolean().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.enabled && value.rubric.trim().length === 0) {
      ctx.addIssue({
        code: "custom",
        message: "pairwise rubric required when enabled",
        path: ["rubric"],
      });
    }
  });

export const createEvaluationComparisonRequestSchema = z.strictObject({
  baselineEvaluationRunId: evaluationRunIdSchema,
  candidateEvaluationRunId: evaluationRunIdSchema,
  policy: evaluationComparisonPolicyV1Schema,
  pairwise: evaluationComparisonPairwiseConfigV1Schema.optional(),
});

export const evaluationComparisonHumanDecisionSchema = z.enum(
  EVALUATION_COMPARISON_HUMAN_DECISIONS,
);

export const submitEvaluationComparisonHumanReviewRequestSchema =
  z.strictObject({
    evaluationCaseId: evaluationCaseIdSchema,
    decision: evaluationComparisonHumanDecisionSchema,
    rationale: z
      .string()
      .min(1)
      .max(EVALUATION_COMPARISON_HUMAN_RATIONALE_MAX_LENGTH)
      .optional(),
    supersedesRevisionId: z.string().optional(),
  });

export const evaluationComparisonPairwisePreferenceSchema = z.enum(
  EVALUATION_COMPARISON_PAIRWISE_PREFERENCES,
);

export const evaluationComparisonPromotionRecommendationSchema = z.enum(
  EVALUATION_COMPARISON_PROMOTION_RECOMMENDATIONS,
);

export const evaluationComparisonResourceSchema = z.strictObject({
  id: evaluationComparisonIdSchema,
  workspaceId: z.string(),
  baselineEvaluationRunId: evaluationRunIdSchema,
  candidateEvaluationRunId: evaluationRunIdSchema,
  evaluationSuiteVersionId: z.string(),
  status: z.string(),
  policy: evaluationComparisonPolicyV1Schema,
  pairwise: evaluationComparisonPairwiseConfigV1Schema.optional(),
  deterministicSummary: z.unknown().optional(),
  pairwiseSummary: z.unknown().optional(),
  regressionAssessment: z.unknown().optional(),
  promotion: z.unknown().optional(),
  costSummary: z.unknown().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
  completedAt: z.string().optional(),
});

export const evaluationComparisonListResourceSchema = z.strictObject({
  comparisons: z.array(evaluationComparisonResourceSchema),
  nextCursor: z.string().optional(),
});

export const evaluationComparisonCalibrationResourceSchema = z.strictObject({
  comparisonId: evaluationComparisonIdSchema,
  judgeRubricIdentity: z.string().optional(),
  modelProfileVersionId: modelProfileVersionIdSchema.optional(),
  reviewedPairCount: z.int().min(0),
  eligiblePairedLabelCount: z.int().min(0),
  exactAgreementCount: z.int().min(0),
  agreementRate: z.number().optional(),
  disagreementCount: z.int().min(0),
  humanUnsureCount: z.int().min(0),
  confusionMatrix: z.record(z.string(), z.record(z.string(), z.int().min(0))),
  unavailableReason: z.string().optional(),
});

export const evaluationComparisonHumanReviewResourceSchema = z.strictObject({
  id: z.string(),
  comparisonId: evaluationComparisonIdSchema,
  evaluationCaseId: evaluationCaseIdSchema,
  reviewerUserId: userIdSchema,
  decision: evaluationComparisonHumanDecisionSchema,
  rationale: z.string().optional(),
  evidenceReference: z.string(),
  supersedesRevisionId: z.string().optional(),
  createdAt: z.string(),
});

export const evaluationComparisonHumanReviewListResourceSchema = z.strictObject(
  {
    reviews: z.array(evaluationComparisonHumanReviewResourceSchema),
  },
);

export const evaluationComparisonListCursorPayloadSchema = z.strictObject({
  createdAt: z.string(),
  id: evaluationComparisonIdSchema,
});

export const listEvaluationComparisonsQuerySchema = z.strictObject({
  limit: z
    .string()
    .regex(/^[1-9]\d*$/, "limit must be a positive integer")
    .optional(),
  cursor: z.string().min(1).optional(),
  status: z.enum(EVALUATION_COMPARISON_STATES).optional(),
  evaluationSuiteVersionId: evaluationSuiteVersionIdSchema.optional(),
  baselineEvaluationRunId: evaluationRunIdSchema.optional(),
  candidateEvaluationRunId: evaluationRunIdSchema.optional(),
});

export const evaluationComparisonAssessmentResourceSchema = z.strictObject({
  comparisonId: evaluationComparisonIdSchema,
  status: z.string(),
  regressionAssessment: z.unknown().optional(),
  promotion: z.unknown().optional(),
  policy: evaluationComparisonPolicyV1Schema,
  completedAt: z.string().optional(),
});

export const evaluationComparisonPairwiseResultResourceSchema = z.strictObject({
  id: z.string(),
  evaluationCaseId: evaluationCaseIdSchema,
  judgmentPosition: z.string(),
  status: z.string(),
  canonicalPreference: evaluationComparisonPairwisePreferenceSchema.optional(),
  reason: z.string().optional(),
  errorCode: z.string().optional(),
  modelProfileVersionId: modelProfileVersionIdSchema.optional(),
  createdAt: z.string(),
  completedAt: z.string().optional(),
});

export const evaluationComparisonPairwiseResultListResourceSchema =
  z.strictObject({
    results: z.array(evaluationComparisonPairwiseResultResourceSchema),
  });
