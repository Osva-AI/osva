import { z } from "zod";

import {
  INFERENCE_BUDGET_LEASE_LOSS_BEHAVIORS,
  INFERENCE_BUDGET_PERIOD_ENFORCEMENT_MODES,
  INFERENCE_BUDGET_PERIOD_KINDS,
  INFERENCE_BUDGET_POLICY_SCHEMA_VERSION,
  INFERENCE_BUDGET_RESERVATION_STATUSES,
  INFERENCE_BUDGET_UNKNOWN_ADMIT_COST_BEHAVIORS,
  INFERENCE_INVOCATION_ANCHOR_FORMAT_VERSION,
  INFERENCE_INVOCATION_KINDS,
  type InferenceBudgetPolicyDefinitionV1,
} from "../inference-budget.js";
import { MODEL_BINDING_NAME_PATTERN } from "../model-gateway.js";
import {
  batchInferenceItemIdSchema,
  evaluationJudgeTaskIdSchema,
  inferenceBudgetPolicyIdSchema,
  inferenceBudgetPolicyVersionIdSchema,
  inferenceBudgetReservationIdSchema,
  inferenceInvocationIdSchema,
  modelProfileVersionIdSchema,
  runAttemptIdSchema,
  runIdSchema,
  runStepIdSchema,
  workspaceIdSchema,
} from "./ids.js";

const usdMicrosSchema = z
  .number()
  .int()
  .nonnegative()
  .finite()
  .max(Number.MAX_SAFE_INTEGER);

const periodKeySchema = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Expected YYYY-MM UTC period key");

export const inferenceBudgetReservationKeySchema = z
  .string()
  .min(1)
  .max(192)
  .regex(/^ibrk_v1_[0-9a-f]{64}$/);

export const inferenceInvocationAnchorMaterialSchema = z.discriminatedUnion(
  "scope",
  [
    z.object({
      scope: z.literal("AGENT_RUN"),
      runAttemptId: runAttemptIdSchema,
      executionGeneration: z.number().int().nonnegative(),
      bindingName: z.string().regex(MODEL_BINDING_NAME_PATTERN),
      modelInvocationOrdinal: z.number().int().nonnegative(),
    }),
    z.object({
      scope: z.literal("EVALUATION_JUDGE"),
      evaluationJudgeTaskId: evaluationJudgeTaskIdSchema,
      sequence: z.number().int().nonnegative(),
    }),
    z.object({
      scope: z.literal("BATCH_INFERENCE"),
      batchInferenceItemId: batchInferenceItemIdSchema,
      submitGeneration: z.number().int().nonnegative().optional(),
    }),
  ],
);

export const inferenceInvocationAnchorContractSchema = z.object({
  anchorFormatVersion: z.literal(INFERENCE_INVOCATION_ANCHOR_FORMAT_VERSION),
  workspaceId: workspaceIdSchema,
  invocationKind: z.enum(INFERENCE_INVOCATION_KINDS),
  material: inferenceInvocationAnchorMaterialSchema,
});

export const inferenceBudgetPolicyDefinitionSchema = z.object({
  schemaVersion: z.literal(INFERENCE_BUDGET_POLICY_SCHEMA_VERSION),
  periodKind: z.enum(INFERENCE_BUDGET_PERIOD_KINDS),
  periodLimitUsdMicros: usdMicrosSchema,
  periodEnforcement: z.enum(INFERENCE_BUDGET_PERIOD_ENFORCEMENT_MODES),
  unknownAdmitCostBehavior: z.enum(
    INFERENCE_BUDGET_UNKNOWN_ADMIT_COST_BEHAVIORS,
  ),
  unknownAdmitCostFloorUsdMicros: usdMicrosSchema.optional(),
  uncertainLiabilityFloorUsdMicros: usdMicrosSchema.optional(),
  onLeaseLoss: z.enum(INFERENCE_BUDGET_LEASE_LOSS_BEHAVIORS),
  staleAdmittedReservationTtlMs: z
    .number()
    .int()
    .positive()
    .max(86_400_000)
    .optional(),
});

export const inferenceBudgetUtcPeriodIdentitySchema = z.object({
  periodKind: z.literal("CALENDAR_MONTH_UTC"),
  periodKey: periodKeySchema,
  periodStartUtc: z.string().datetime(),
  periodEndExclusiveUtc: z.string().datetime(),
});

export const inferenceBudgetPeriodLedgerSchema = z.object({
  workspaceId: workspaceIdSchema,
  period: inferenceBudgetUtcPeriodIdentitySchema,
  budgetPolicyVersionId: inferenceBudgetPolicyVersionIdSchema,
  limitUsdMicros: usdMicrosSchema,
  committedLiabilityUsdMicros: usdMicrosSchema,
  heldReservationsUsdMicros: usdMicrosSchema,
  unresolvedUncertainLiabilityUsdMicros: usdMicrosSchema,
  overageUsdMicros: usdMicrosSchema,
});

export const inferenceBudgetReservationSnapshotSchema = z.object({
  id: inferenceBudgetReservationIdSchema,
  workspaceId: workspaceIdSchema,
  reservationKey: inferenceBudgetReservationKeySchema,
  inferenceInvocationId: inferenceInvocationIdSchema,
  providerAttemptIndex: z.number().int().nonnegative().max(64),
  selectedModelProfileVersionId: modelProfileVersionIdSchema,
  periodKey: periodKeySchema,
  budgetPolicyVersionId: inferenceBudgetPolicyVersionIdSchema,
  pricingSnapshotId: z.string().min(1).max(256),
  status: z.enum(INFERENCE_BUDGET_RESERVATION_STATUSES),
  reservedUsdMicros: usdMicrosSchema,
  committedUsdMicros: usdMicrosSchema.nullable().optional(),
  uncertainFloorUsdMicros: usdMicrosSchema.optional(),
  providerRequestId: z.string().min(1).max(512).optional(),
  runStepId: runStepIdSchema.optional(),
});

export const inferenceBudgetProviderAttemptContextSchema = z.object({
  workspaceId: workspaceIdSchema,
  inferenceInvocationId: inferenceInvocationIdSchema,
  invocationAnchor: z.string().min(1).max(2048),
  periodKey: periodKeySchema,
  budgetPolicyVersionId: inferenceBudgetPolicyVersionIdSchema,
  pricingSnapshotId: z.string().min(1).max(256),
  providerAttemptIndex: z.number().int().nonnegative().max(64),
  selectedModelProfileVersionId: modelProfileVersionIdSchema,
  admitCeilingUsdMicros: usdMicrosSchema.nullable(),
  runStepId: runStepIdSchema.optional(),
  runAttemptId: runAttemptIdSchema.optional(),
  providerRequestId: z.string().min(1).max(512).optional(),
});

export const inferenceBudgetRuntimePolicySchema = z.object({
  schemaVersion: z.literal(INFERENCE_BUDGET_POLICY_SCHEMA_VERSION),
  enabled: z.boolean(),
  policyVersionId: inferenceBudgetPolicyVersionIdSchema.optional(),
  definition: inferenceBudgetPolicyDefinitionSchema.optional(),
  policyRevisionId: z.string().min(1).max(256).optional(),
});

export const workspaceInferenceBudgetActivationSchema = z.object({
  schemaVersion: z.literal(INFERENCE_BUDGET_POLICY_SCHEMA_VERSION),
  workspaceId: workspaceIdSchema,
  enabled: z.boolean(),
  activePolicyVersionId: inferenceBudgetPolicyVersionIdSchema.optional(),
  updatedAt: z.string().datetime(),
});

export const inferenceBudgetPolicyVersionRecordSchema = z.object({
  id: inferenceBudgetPolicyVersionIdSchema,
  policyId: inferenceBudgetPolicyIdSchema,
  workspaceId: workspaceIdSchema,
  version: z.number().int().positive(),
  definition: inferenceBudgetPolicyDefinitionSchema,
  createdAt: z.string().datetime(),
});

export const inferenceBudgetPolicyRecordSchema = z.object({
  id: inferenceBudgetPolicyIdSchema,
  workspaceId: workspaceIdSchema,
  key: z.string().min(1).max(64),
  createdAt: z.string().datetime(),
});

export const createInferenceBudgetPolicyRequestSchema = z.object({
  key: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[A-Za-z][A-Za-z0-9_-]{0,63}$/),
  definition: inferenceBudgetPolicyDefinitionSchema,
});

export const appendInferenceBudgetPolicyVersionRequestSchema = z.object({
  definition: inferenceBudgetPolicyDefinitionSchema,
});

export const inferenceBudgetPeriodUsageQuerySchema = z.object({
  periodKey: periodKeySchema.optional(),
});

export const inferenceBudgetPeriodUsageResponseSchema = z.object({
  period: inferenceBudgetUtcPeriodIdentitySchema,
  ledger: inferenceBudgetPeriodLedgerSchema.nullable(),
  availableReservationCapacityUsdMicros: usdMicrosSchema.nullable(),
  liabilityAccountingKind: z.literal("ESTIMATED_RESERVATION_LIABILITY"),
});

export const activateWorkspaceInferenceBudgetRequestSchema = z.object({
  policyVersionId: inferenceBudgetPolicyVersionIdSchema,
});

export const workspaceInferenceBudgetConfigurationResponseSchema = z.object({
  activation: workspaceInferenceBudgetActivationSchema,
  runtimePolicy: inferenceBudgetRuntimePolicySchema,
  activationMutationsPermitted: z.boolean(),
});

export const workspaceInferenceBudgetActivationStatusResponseSchema = z.object({
  activation: workspaceInferenceBudgetActivationSchema,
  runtimePolicy: inferenceBudgetRuntimePolicySchema,
  activationMutationsPermitted: z.boolean(),
});

export const inferenceInvocationRecordSchema = z.object({
  id: inferenceInvocationIdSchema,
  workspaceId: workspaceIdSchema,
  invocationAnchor: z.string().min(1).max(2048),
  anchor: inferenceInvocationAnchorContractSchema,
  periodKey: periodKeySchema,
  budgetPolicyVersionId: inferenceBudgetPolicyVersionIdSchema,
  pricingSnapshotId: z.string().min(1).max(256),
  runId: runIdSchema.optional(),
  runAttemptId: runAttemptIdSchema.optional(),
  runStepId: runStepIdSchema.optional(),
  createdAt: z.string().datetime(),
});

export function parseInferenceBudgetPolicyDefinition(
  value: unknown,
): InferenceBudgetPolicyDefinitionV1 {
  const parsed = inferenceBudgetPolicyDefinitionSchema.parse(value);
  if (
    parsed.unknownAdmitCostBehavior === "USE_POLICY_FLOOR_USD_MICROS" &&
    parsed.unknownAdmitCostFloorUsdMicros === undefined
  ) {
    throw new Error(
      "unknownAdmitCostFloorUsdMicros is required when unknownAdmitCostBehavior is USE_POLICY_FLOOR_USD_MICROS",
    );
  }
  return parsed;
}

export { defaultUncertainLiabilityFloorUsdMicros } from "../inference-budget.js";
