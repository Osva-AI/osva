import { z } from "zod";

import {
  EVALUATION_QUALITY_GATE_ASSESSMENT_SCHEMA_VERSION,
  EVALUATION_QUALITY_GATE_METRICS,
  EVALUATION_QUALITY_GATE_MIN_METRICS,
  EVALUATION_QUALITY_GATE_POLICY_SCHEMA_VERSION,
  EVALUATION_QUALITY_GATE_REASON_CODES,
  EVALUATION_QUALITY_GATE_VERDICTS,
} from "../evaluation-quality-gate.js";

export const MAX_EVALUATION_QUALITY_GATE_RULES = 16;

const finiteUnitRate = z.number().finite().min(0).max(1);

const finiteNonNegativeInt = z.number().int().min(0).finite();

const evaluationQualityGateMinRuleSchema = z.strictObject({
  metric: z.enum(EVALUATION_QUALITY_GATE_MIN_METRICS),
  operator: z.literal("MIN"),
  threshold: finiteUnitRate,
});

const evaluationQualityGateMaxRuleSchema = z.discriminatedUnion("metric", [
  z.strictObject({
    metric: z.literal("ERROR_COUNT"),
    operator: z.literal("MAX"),
    threshold: finiteNonNegativeInt,
  }),
  z.strictObject({
    metric: z.literal("ESTIMATED_COST_USD_MICROS"),
    operator: z.literal("MAX"),
    threshold: finiteNonNegativeInt,
  }),
  z.strictObject({
    metric: z.literal("DURATION_MS"),
    operator: z.literal("MAX"),
    threshold: finiteNonNegativeInt,
  }),
]);

export const evaluationQualityGateRuleSchema = z.union([
  evaluationQualityGateMinRuleSchema,
  evaluationQualityGateMaxRuleSchema,
]);

export const evaluationQualityGatePolicySchema = z
  .strictObject({
    schemaVersion: z.literal(EVALUATION_QUALITY_GATE_POLICY_SCHEMA_VERSION),
    rules: z
      .array(evaluationQualityGateRuleSchema)
      .min(1)
      .max(MAX_EVALUATION_QUALITY_GATE_RULES),
  })
  .superRefine((policy, context) => {
    const seen = new Set<string>();
    for (const rule of policy.rules) {
      if (seen.has(rule.metric)) {
        context.addIssue({
          code: "custom",
          message: `Duplicate quality gate metric '${rule.metric}'.`,
          path: ["rules"],
        });
        return;
      }
      seen.add(rule.metric);
    }
  });

export const evaluationQualityGateRuleResultSchema = z.strictObject({
  metric: z.enum(EVALUATION_QUALITY_GATE_METRICS),
  operator: z.enum(["MIN", "MAX"]),
  threshold: z.number().finite(),
  observedValue: z.number().finite().optional(),
  verdict: z.enum(EVALUATION_QUALITY_GATE_VERDICTS),
  reasonCode: z.enum([
    EVALUATION_QUALITY_GATE_REASON_CODES.THRESHOLD_SATISFIED,
    EVALUATION_QUALITY_GATE_REASON_CODES.THRESHOLD_VIOLATED,
    EVALUATION_QUALITY_GATE_REASON_CODES.MISSING_EVIDENCE,
    EVALUATION_QUALITY_GATE_REASON_CODES.COST_INCONCLUSIVE_UNPRICED,
    EVALUATION_QUALITY_GATE_REASON_CODES.LIFECYCLE_INCOMPLETE,
    EVALUATION_QUALITY_GATE_REASON_CODES.LIFECYCLE_RUN_FAILED,
    EVALUATION_QUALITY_GATE_REASON_CODES.LIFECYCLE_RUN_CANCELLED,
  ]),
});

export const evaluationQualityGateAssessmentSchema = z.strictObject({
  schemaVersion: z.literal(EVALUATION_QUALITY_GATE_ASSESSMENT_SCHEMA_VERSION),
  overallVerdict: z.enum(EVALUATION_QUALITY_GATE_VERDICTS),
  lifecycleVerdict: z.enum(EVALUATION_QUALITY_GATE_VERDICTS),
  ruleResults: z.array(evaluationQualityGateRuleResultSchema),
  assessedAt: z.string().min(1),
});

export const evaluationRunQualityGateSchema = z.strictObject({
  policy: evaluationQualityGatePolicySchema,
  assessment: evaluationQualityGateAssessmentSchema.optional(),
});
