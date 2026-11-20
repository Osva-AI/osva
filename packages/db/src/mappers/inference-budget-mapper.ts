import type {
  InferenceBudgetPeriodKeyV1,
  InferenceBudgetPeriodLedgerV1,
  InferenceBudgetPolicyDefinitionV1,
  InferenceBudgetPolicyId,
  InferenceBudgetPolicyRecordV1,
  InferenceBudgetPolicyVersionRecordV1,
  InferenceBudgetPolicyVersionId,
  InferenceBudgetReservationId,
  InferenceBudgetReservationKeyV1,
  InferenceBudgetReservationSnapshotV1,
  InferenceBudgetReservationStatus,
  InferenceBudgetRuntimePolicyV1,
  InferenceBudgetUtcPeriodIdentityV1,
  InferenceInvocationAnchorContractV1,
  InferenceInvocationId,
  InferenceInvocationKind,
  InferenceInvocationRecordV1,
  ModelProfileVersionId,
  WorkspaceId,
} from "@osva-ai/contracts";
import { INFERENCE_BUDGET_POLICY_SCHEMA_VERSION } from "@osva-ai/contracts";
import { inferenceBudgetPolicyDefinitionSchema } from "@osva-ai/contracts/schemas";

import type { inferenceBudgetPolicies } from "../schema/inference-budget-policies.js";
import type { inferenceBudgetPolicyVersions } from "../schema/inference-budget-policy-versions.js";
import type { inferenceBudgetReservations } from "../schema/inference-budget-reservations.js";
import type { inferenceInvocations } from "../schema/inference-invocations.js";
import type { workspaceInferenceBudgetActivation } from "../schema/workspace-inference-budget-activation.js";
import type { workspaceInferenceBudgetPeriods } from "../schema/workspace-inference-budget-periods.js";

type PolicyRow = typeof inferenceBudgetPolicies.$inferSelect;
type VersionRow = typeof inferenceBudgetPolicyVersions.$inferSelect;
type ActivationRow = typeof workspaceInferenceBudgetActivation.$inferSelect;
type PeriodRow = typeof workspaceInferenceBudgetPeriods.$inferSelect;
type InvocationRow = typeof inferenceInvocations.$inferSelect;
type ReservationRow = typeof inferenceBudgetReservations.$inferSelect;

export function parseInferenceBudgetDefinition(
  value: unknown,
): InferenceBudgetPolicyDefinitionV1 {
  return inferenceBudgetPolicyDefinitionSchema.parse(value);
}

export function inferenceBudgetPolicyFromRow(
  row: PolicyRow,
): InferenceBudgetPolicyRecordV1 {
  return {
    id: row.id as InferenceBudgetPolicyId,
    workspaceId: row.workspaceId as WorkspaceId,
    key: row.key,
    createdAt: row.createdAt.toISOString(),
  };
}

export function inferenceBudgetPolicyVersionFromRow(
  row: VersionRow,
): InferenceBudgetPolicyVersionRecordV1 {
  return {
    id: row.id as InferenceBudgetPolicyVersionId,
    policyId: row.policyId as InferenceBudgetPolicyId,
    workspaceId: row.workspaceId as WorkspaceId,
    version: row.version,
    definition: parseInferenceBudgetDefinition(row.definitionJson),
    createdAt: row.createdAt.toISOString(),
  };
}

export function inferenceBudgetRuntimePolicyFromActivation(input: {
  readonly activation: ActivationRow | undefined;
  readonly version: VersionRow | undefined;
}): InferenceBudgetRuntimePolicyV1 | null {
  if (input.activation === undefined) {
    return null;
  }

  if (!input.activation.enabled) {
    return {
      schemaVersion: INFERENCE_BUDGET_POLICY_SCHEMA_VERSION,
      enabled: false,
      policyRevisionId: input.activation.updatedAt.toISOString(),
    };
  }

  if (input.version === undefined) {
    return {
      schemaVersion: INFERENCE_BUDGET_POLICY_SCHEMA_VERSION,
      enabled: false,
      policyRevisionId: input.activation.updatedAt.toISOString(),
    };
  }

  return {
    schemaVersion: INFERENCE_BUDGET_POLICY_SCHEMA_VERSION,
    enabled: true,
    policyVersionId: input.version.id as InferenceBudgetPolicyVersionId,
    definition: parseInferenceBudgetDefinition(input.version.definitionJson),
    policyRevisionId: input.activation.updatedAt.toISOString(),
  };
}

export function inferenceBudgetPeriodIdentityFromRow(
  row: PeriodRow,
): InferenceBudgetUtcPeriodIdentityV1 {
  return {
    periodKind: row.periodKind as "CALENDAR_MONTH_UTC",
    periodKey: row.periodKey as InferenceBudgetPeriodKeyV1,
    periodStartUtc: row.periodStartUtc.toISOString(),
    periodEndExclusiveUtc: row.periodEndExclusiveUtc.toISOString(),
  };
}

export function inferenceBudgetPeriodLedgerFromRow(
  row: PeriodRow,
): InferenceBudgetPeriodLedgerV1 {
  return {
    workspaceId: row.workspaceId as WorkspaceId,
    period: inferenceBudgetPeriodIdentityFromRow(row),
    budgetPolicyVersionId:
      row.budgetPolicyVersionId as InferenceBudgetPolicyVersionId,
    limitUsdMicros: row.limitUsdMicros,
    committedLiabilityUsdMicros: row.committedLiabilityUsdMicros,
    heldReservationsUsdMicros: row.heldReservationsUsdMicros,
    unresolvedUncertainLiabilityUsdMicros:
      row.unresolvedUncertainLiabilityUsdMicros,
    overageUsdMicros: row.overageUsdMicros,
  };
}

export function inferenceInvocationFromRow(
  row: InvocationRow,
): InferenceInvocationRecordV1 {
  return {
    id: row.id as InferenceInvocationId,
    workspaceId: row.workspaceId as WorkspaceId,
    invocationAnchor: row.invocationAnchor,
    anchor: row.anchorJson as InferenceInvocationAnchorContractV1,
    periodKey: row.periodKey as InferenceBudgetPeriodKeyV1,
    budgetPolicyVersionId:
      row.budgetPolicyVersionId as InferenceBudgetPolicyVersionId,
    pricingSnapshotId: row.pricingSnapshotId,
    runId: (row.runId ?? undefined) as InferenceInvocationRecordV1["runId"],
    runAttemptId:
      row.runAttemptId as InferenceInvocationRecordV1["runAttemptId"],
    runStepId: (row.runStepId ??
      undefined) as InferenceInvocationRecordV1["runStepId"],
    executionGeneration: row.executionGeneration ?? undefined,
    lastExecutionGeneration: row.lastExecutionGeneration ?? undefined,
    createdAt: row.createdAt.toISOString(),
  };
}

export function inferenceBudgetReservationFromRow(
  row: ReservationRow,
): InferenceBudgetReservationSnapshotV1 {
  return {
    id: row.id as InferenceBudgetReservationId,
    workspaceId: row.workspaceId as WorkspaceId,
    reservationKey: row.reservationKey as InferenceBudgetReservationKeyV1,
    inferenceInvocationId: row.inferenceInvocationId as InferenceInvocationId,
    providerAttemptIndex: row.providerAttemptIndex,
    selectedModelProfileVersionId:
      row.selectedModelProfileVersionId as ModelProfileVersionId,
    periodKey: row.periodKey as InferenceBudgetPeriodKeyV1,
    budgetPolicyVersionId:
      row.budgetPolicyVersionId as InferenceBudgetPolicyVersionId,
    pricingSnapshotId: row.pricingSnapshotId,
    status: row.status as InferenceBudgetReservationStatus,
    reservedUsdMicros: row.reservedUsdMicros,
    committedUsdMicros: row.committedUsdMicros,
    uncertainFloorUsdMicros: row.uncertainFloorUsdMicros ?? undefined,
    providerRequestId: (row.providerRequestId ??
      undefined) as InferenceBudgetReservationSnapshotV1["providerRequestId"],
    runStepId: (row.runStepId ??
      undefined) as InferenceBudgetReservationSnapshotV1["runStepId"],
    admittedExecutionGeneration: row.admittedExecutionGeneration ?? undefined,
  };
}

export function inferenceInvocationKindFromAnchor(
  anchor: InferenceInvocationAnchorContractV1,
): InferenceInvocationKind {
  if (anchor.material.scope === "EVALUATION_JUDGE") {
    return "JUDGE";
  }
  if (anchor.material.scope === "BATCH_INFERENCE") {
    return "BATCH";
  }
  return anchor.invocationKind;
}
