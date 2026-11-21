import type {
  BatchInferenceItemId,
  EvaluationJudgeTaskId,
  InferenceBudgetPolicyId,
  InferenceBudgetPolicyVersionId,
  InferenceBudgetReservationId,
  InferenceInvocationId,
  ModelProfileVersionId,
  RunAttemptId,
  RunId,
  RunStepId,
  WorkspaceId,
} from "./ids.js";

export const INFERENCE_BUDGET_POLICY_SCHEMA_VERSION = "1" as const;

export type InferenceBudgetPolicySchemaVersion =
  typeof INFERENCE_BUDGET_POLICY_SCHEMA_VERSION;

export const INFERENCE_INVOCATION_ANCHOR_FORMAT_VERSION = "2" as const;

export type InferenceInvocationAnchorFormatVersion =
  typeof INFERENCE_INVOCATION_ANCHOR_FORMAT_VERSION;

export const INFERENCE_BUDGET_RESERVATION_KEY_VERSION = "1" as const;

export type InferenceBudgetReservationKeyVersion =
  typeof INFERENCE_BUDGET_RESERVATION_KEY_VERSION;

export const INFERENCE_BUDGET_RESERVATION_KEY_PREFIX = "ibrk_v1_" as const;

/**
 * Deterministic reservation idempotency digest. Distinct from
 * {@link InferenceInvocationId}, provider attempt index, and {@link RunStepId}.
 */
export type InferenceBudgetReservationKeyV1 = string & {
  readonly __brand: "InferenceBudgetReservationKeyV1";
};

/** Opaque provider-issued HTTP/stream request id for reconciliation correlation only. */
export type InferenceBudgetProviderRequestId = string & {
  readonly __brand: "InferenceBudgetProviderRequestId";
};

export const INFERENCE_INVOCATION_KINDS = [
  "SYNC",
  "STREAM",
  "JUDGE",
  "BATCH",
] as const;

export type InferenceInvocationKind =
  (typeof INFERENCE_INVOCATION_KINDS)[number];

export const INFERENCE_INVOCATION_ANCHOR_SCOPES = [
  "AGENT_RUN",
  "EVALUATION_JUDGE",
  "BATCH_INFERENCE",
] as const;

export type InferenceInvocationAnchorScope =
  (typeof INFERENCE_INVOCATION_ANCHOR_SCOPES)[number];

export const INFERENCE_BUDGET_PERIOD_KINDS = ["CALENDAR_MONTH_UTC"] as const;

export type InferenceBudgetPeriodKind =
  (typeof INFERENCE_BUDGET_PERIOD_KINDS)[number];

export const INFERENCE_BUDGET_PERIOD_ENFORCEMENT_MODES = [
  "STRICT_PERIOD_CAP",
] as const;

export type InferenceBudgetPeriodEnforcementMode =
  (typeof INFERENCE_BUDGET_PERIOD_ENFORCEMENT_MODES)[number];

export const INFERENCE_BUDGET_RESERVATION_STATUSES = [
  "ADMITTED",
  "PROVIDER_STARTED",
  "COMMITTED",
  "RELEASED",
  "RECONCILIATION_REQUIRED",
  "EXPIRED",
] as const;

export type InferenceBudgetReservationStatus =
  (typeof INFERENCE_BUDGET_RESERVATION_STATUSES)[number];

export const INFERENCE_BUDGET_TERMINAL_RESERVATION_STATUSES = [
  "COMMITTED",
  "RELEASED",
  "EXPIRED",
] as const;

export type InferenceBudgetTerminalReservationStatus =
  (typeof INFERENCE_BUDGET_TERMINAL_RESERVATION_STATUSES)[number];

export const INFERENCE_BUDGET_UNKNOWN_ADMIT_COST_BEHAVIORS = [
  "DENY_ADMISSION",
  "USE_POLICY_FLOOR_USD_MICROS",
] as const;

export type InferenceBudgetUnknownAdmitCostBehavior =
  (typeof INFERENCE_BUDGET_UNKNOWN_ADMIT_COST_BEHAVIORS)[number];

export const INFERENCE_BUDGET_LEASE_LOSS_BEHAVIORS = [
  "RECONCILIATION_REQUIRED",
  "EXPIRE",
] as const;

export type InferenceBudgetLeaseLossBehavior =
  (typeof INFERENCE_BUDGET_LEASE_LOSS_BEHAVIORS)[number];

export const INFERENCE_BUDGET_ERROR_CODES = {
  MODEL_INFERENCE_BUDGET_EXCEEDED: "MODEL_INFERENCE_BUDGET_EXCEEDED",
  MODEL_INFERENCE_BUDGET_UNAVAILABLE: "MODEL_INFERENCE_BUDGET_UNAVAILABLE",
} as const;

export type InferenceBudgetErrorCode =
  (typeof INFERENCE_BUDGET_ERROR_CODES)[keyof typeof INFERENCE_BUDGET_ERROR_CODES];

export const INFERENCE_BUDGET_NON_RETRYABLE_ERROR_CODES = [
  INFERENCE_BUDGET_ERROR_CODES.MODEL_INFERENCE_BUDGET_EXCEEDED,
] as const satisfies readonly InferenceBudgetErrorCode[];

export const INFERENCE_BUDGET_NON_FALLBACK_ERROR_CODES = [
  INFERENCE_BUDGET_ERROR_CODES.MODEL_INFERENCE_BUDGET_EXCEEDED,
  INFERENCE_BUDGET_ERROR_CODES.MODEL_INFERENCE_BUDGET_UNAVAILABLE,
] as const satisfies readonly InferenceBudgetErrorCode[];

export function isInferenceBudgetErrorCode(
  value: string,
): value is InferenceBudgetErrorCode {
  return (
    Object.values(INFERENCE_BUDGET_ERROR_CODES) as readonly string[]
  ).includes(value);
}

export function isInferenceBudgetNonRetryableErrorCode(
  value: string,
): value is InferenceBudgetErrorCode {
  return (
    INFERENCE_BUDGET_NON_RETRYABLE_ERROR_CODES as readonly string[]
  ).includes(value);
}

export function isInferenceBudgetNonFallbackErrorCode(
  value: string,
): value is InferenceBudgetErrorCode {
  return (
    INFERENCE_BUDGET_NON_FALLBACK_ERROR_CODES as readonly string[]
  ).includes(value);
}

export type InferenceInvocationAnchorMaterialV1 =
  | {
      readonly scope: "AGENT_RUN";
      readonly runAttemptId: RunAttemptId;
      readonly executionGeneration: number;
      readonly bindingName: string;
      readonly modelInvocationOrdinal: number;
    }
  | {
      readonly scope: "EVALUATION_JUDGE";
      readonly evaluationJudgeTaskId: EvaluationJudgeTaskId;
      readonly sequence: number;
    }
  | {
      readonly scope: "BATCH_INFERENCE";
      readonly batchInferenceItemId: BatchInferenceItemId;
      readonly submitGeneration?: number;
    };

/**
 * Versioned deterministic anchor material. `RunStepId` is intentionally absent.
 */
export interface InferenceInvocationAnchorContractV1 {
  readonly anchorFormatVersion: InferenceInvocationAnchorFormatVersion;
  readonly workspaceId: WorkspaceId;
  readonly invocationKind: InferenceInvocationKind;
  readonly material: InferenceInvocationAnchorMaterialV1;
}

export interface InferenceInvocationRecordV1 {
  readonly id: InferenceInvocationId;
  readonly workspaceId: WorkspaceId;
  readonly invocationAnchor: string;
  readonly anchor: InferenceInvocationAnchorContractV1;
  readonly periodKey: InferenceBudgetPeriodKeyV1;
  readonly budgetPolicyVersionId: InferenceBudgetPolicyVersionId;
  readonly pricingSnapshotId: string;
  readonly runId?: RunId;
  readonly runAttemptId?: RunAttemptId;
  readonly runStepId?: RunStepId;
  readonly executionGeneration?: number;
  readonly lastExecutionGeneration?: number;
  readonly createdAt: string;
}

/** UTC calendar month identity (`YYYY-MM`). */
export type InferenceBudgetPeriodKeyV1 = string & {
  readonly __brand: "InferenceBudgetPeriodKeyV1";
};

export interface InferenceBudgetUtcPeriodIdentityV1 {
  readonly periodKind: InferenceBudgetPeriodKind;
  readonly periodKey: InferenceBudgetPeriodKeyV1;
  readonly periodStartUtc: string;
  readonly periodEndExclusiveUtc: string;
}

export interface InferenceBudgetPolicyDefinitionV1 {
  readonly schemaVersion: InferenceBudgetPolicySchemaVersion;
  readonly periodKind: InferenceBudgetPeriodKind;
  readonly periodLimitUsdMicros: number;
  readonly periodEnforcement: InferenceBudgetPeriodEnforcementMode;
  readonly unknownAdmitCostBehavior: InferenceBudgetUnknownAdmitCostBehavior;
  readonly unknownAdmitCostFloorUsdMicros?: number;
  readonly uncertainLiabilityFloorUsdMicros?: number;
  readonly onLeaseLoss: InferenceBudgetLeaseLossBehavior;
  readonly staleAdmittedReservationTtlMs?: number;
}

export interface InferenceBudgetPolicyVersionRecordV1 {
  readonly id: InferenceBudgetPolicyVersionId;
  readonly policyId: InferenceBudgetPolicyId;
  readonly workspaceId: WorkspaceId;
  readonly version: number;
  readonly definition: InferenceBudgetPolicyDefinitionV1;
  readonly createdAt: string;
}

export interface InferenceBudgetPolicyRecordV1 {
  readonly id: InferenceBudgetPolicyId;
  readonly workspaceId: WorkspaceId;
  readonly key: string;
  readonly createdAt: string;
}

export interface WorkspaceInferenceBudgetActivationV1 {
  readonly schemaVersion: InferenceBudgetPolicySchemaVersion;
  readonly workspaceId: WorkspaceId;
  readonly enabled: boolean;
  readonly activePolicyVersionId?: InferenceBudgetPolicyVersionId;
  readonly updatedAt: string;
}

export interface InferenceBudgetRuntimePolicyV1 {
  readonly schemaVersion: InferenceBudgetPolicySchemaVersion;
  readonly enabled: boolean;
  readonly policyVersionId?: InferenceBudgetPolicyVersionId;
  readonly definition?: InferenceBudgetPolicyDefinitionV1;
  readonly policyRevisionId?: string;
}

export interface InferenceBudgetPeriodLedgerV1 {
  readonly workspaceId: WorkspaceId;
  readonly period: InferenceBudgetUtcPeriodIdentityV1;
  readonly budgetPolicyVersionId: InferenceBudgetPolicyVersionId;
  readonly limitUsdMicros: number;
  readonly committedLiabilityUsdMicros: number;
  readonly heldReservationsUsdMicros: number;
  readonly unresolvedUncertainLiabilityUsdMicros: number;
  readonly overageUsdMicros: number;
}

export interface InferenceBudgetReservationSnapshotV1 {
  readonly id: InferenceBudgetReservationId;
  readonly workspaceId: WorkspaceId;
  readonly reservationKey: InferenceBudgetReservationKeyV1;
  readonly inferenceInvocationId: InferenceInvocationId;
  readonly providerAttemptIndex: number;
  readonly selectedModelProfileVersionId: ModelProfileVersionId;
  readonly periodKey: InferenceBudgetPeriodKeyV1;
  readonly budgetPolicyVersionId: InferenceBudgetPolicyVersionId;
  readonly pricingSnapshotId: string;
  readonly status: InferenceBudgetReservationStatus;
  readonly reservedUsdMicros: number;
  readonly committedUsdMicros?: number | null;
  readonly uncertainFloorUsdMicros?: number;
  readonly providerRequestId?: InferenceBudgetProviderRequestId;
  readonly runStepId?: RunStepId;
  readonly admittedExecutionGeneration?: number;
}

/**
 * Pre-invocation attempt context populated before provider HTTP.
 * Not interchangeable with post-invocation routing telemetry.
 */
export interface InferenceBudgetProviderAttemptContextV1 {
  readonly workspaceId: WorkspaceId;
  readonly inferenceInvocationId: InferenceInvocationId;
  readonly invocationAnchor: string;
  readonly periodKey: InferenceBudgetPeriodKeyV1;
  readonly budgetPolicyVersionId: InferenceBudgetPolicyVersionId;
  readonly pricingSnapshotId: string;
  readonly providerAttemptIndex: number;
  readonly selectedModelProfileVersionId: ModelProfileVersionId;
  readonly admitCeilingUsdMicros: number | null;
  readonly runStepId?: RunStepId;
  readonly runAttemptId?: RunAttemptId;
  readonly providerRequestId?: InferenceBudgetProviderRequestId;
  readonly admittedExecutionGeneration?: number;
}

export interface InferenceBudgetAdmissionContextV1 {
  readonly attempt: InferenceBudgetProviderAttemptContextV1;
  readonly reservationKey: InferenceBudgetReservationKeyV1;
}

export interface InferenceBudgetAdmissionEvaluateInputV1 {
  readonly workspaceId: WorkspaceId;
  readonly activation: Pick<WorkspaceInferenceBudgetActivationV1, "enabled">;
  readonly policy: InferenceBudgetPolicyDefinitionV1 | undefined;
  readonly periodLedger: InferenceBudgetPeriodLedgerV1;
  readonly admitCeilingUsdMicros: number | null;
  readonly reservationKey: InferenceBudgetReservationKeyV1;
  readonly existingReservation?: InferenceBudgetReservationSnapshotV1;
}

export type InferenceBudgetAdmissionOutcomeV1 =
  | {
      readonly outcome: "BYPASSED";
      readonly reason: "POLICY_DISABLED" | "ACTIVATION_DISABLED";
    }
  | {
      readonly outcome: "IDEMPOTENT_EXISTING";
      readonly reservation: InferenceBudgetReservationSnapshotV1;
    }
  | {
      readonly outcome: "ADMITTED";
      readonly reservation: InferenceBudgetReservationSnapshotV1;
      readonly periodLedgerAfter: InferenceBudgetPeriodLedgerV1;
    }
  | {
      readonly outcome: "DENIED";
      readonly errorCode: InferenceBudgetErrorCode;
      readonly retryable: false;
    };

export interface InferenceBudgetReconcileInputV1 {
  readonly workspaceId: WorkspaceId;
  readonly reservation: InferenceBudgetReservationSnapshotV1;
  readonly periodLedger: InferenceBudgetPeriodLedgerV1;
  readonly committedUsdMicros: number | null | undefined;
  readonly usageKnown: boolean;
  readonly providerAccepted: boolean;
  readonly billableProviderOutcome: boolean;
  readonly nonBillableCancelBeforeAccept?: boolean;
}

export interface InferenceBudgetPeriodBucketDeltaV1 {
  readonly committedLiabilityUsdMicros: number;
  readonly heldReservationsUsdMicros: number;
  readonly unresolvedUncertainLiabilityUsdMicros: number;
  readonly overageUsdMicros: number;
}

export interface InferenceBudgetReconcileOutcomeV1 {
  readonly nextStatus: InferenceBudgetReservationStatus;
  readonly periodDelta: InferenceBudgetPeriodBucketDeltaV1;
  readonly refundHeldUsdMicros: number;
  readonly overageUsdMicros: number;
  readonly committedUsdMicros: number | null;
  readonly periodLedgerAfter: InferenceBudgetPeriodLedgerV1;
  readonly reservationAfter: InferenceBudgetReservationSnapshotV1;
}

export interface InferenceBudgetAllocateInvocationRequestV1 {
  readonly workspaceId: WorkspaceId;
  readonly anchor: InferenceInvocationAnchorContractV1;
  readonly periodKey: InferenceBudgetPeriodKeyV1;
  readonly budgetPolicyVersionId: InferenceBudgetPolicyVersionId;
  readonly pricingSnapshotId: string;
  readonly runId?: RunId;
  readonly runAttemptId?: RunAttemptId;
  readonly runStepId?: RunStepId;
  readonly executionGenerationFence?: number;
}

export interface InferenceBudgetAdmitOrGetExistingRequestV1 {
  readonly workspaceId: WorkspaceId;
  readonly attempt: InferenceBudgetProviderAttemptContextV1;
  readonly reservationKey: InferenceBudgetReservationKeyV1;
  readonly admitCeilingUsdMicros: number;
}

export interface InferenceBudgetMarkProviderStartedRequestV1 {
  readonly workspaceId: WorkspaceId;
  readonly reservationId: InferenceBudgetReservationId;
  readonly providerRequestId?: InferenceBudgetProviderRequestId;
  readonly executionGeneration?: number;
  readonly runAttemptId?: RunAttemptId;
  readonly executionOwner?: string;
}

export interface InferenceBudgetAllocateModelInvocationOrdinalRequestV1 {
  readonly workspaceId: WorkspaceId;
  readonly runAttemptId: RunAttemptId;
  readonly bindingName: string;
  readonly logicalOperationKey: string;
}

export interface InferenceBudgetModelInvocationOrdinalV1 {
  readonly modelInvocationOrdinal: number;
  readonly logicalOperationKey: string;
}

export const DEFAULT_INFERENCE_BUDGET_RECONCILIATION_BATCH_LIMIT = 50;

export interface InferenceBudgetInvocationOrdinalPort {
  allocateOrGetOrdinal(
    request: InferenceBudgetAllocateModelInvocationOrdinalRequestV1,
  ): Promise<InferenceBudgetModelInvocationOrdinalV1>;
}

export class InferenceBudgetProviderStartFenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InferenceBudgetProviderStartFenceError";
  }
}

export interface InferenceBudgetReleaseRequestV1 {
  readonly workspaceId: WorkspaceId;
  readonly reservation: InferenceBudgetReservationSnapshotV1;
  readonly periodLedger: InferenceBudgetPeriodLedgerV1;
}

export interface InferenceBudgetMarkReconciliationRequiredRequestV1 {
  readonly workspaceId: WorkspaceId;
  readonly reservation: InferenceBudgetReservationSnapshotV1;
  readonly periodLedger: InferenceBudgetPeriodLedgerV1;
  readonly uncertainFloorUsdMicros?: number;
}

/**
 * Admission and reconciliation port implemented in `@osva/db` (B5.2+).
 */
export interface InferenceBudgetAdmissionPort {
  allocateInvocation(
    request: InferenceBudgetAllocateInvocationRequestV1,
  ): Promise<InferenceInvocationRecordV1>;

  admitOrGetExisting(
    request: InferenceBudgetAdmitOrGetExistingRequestV1,
  ): Promise<InferenceBudgetAdmissionOutcomeV1>;

  markProviderStarted(
    request: InferenceBudgetMarkProviderStartedRequestV1,
  ): Promise<InferenceBudgetReservationSnapshotV1>;

  reconcile(
    request: InferenceBudgetReconcileInputV1,
  ): Promise<InferenceBudgetReconcileOutcomeV1>;

  release(
    request: InferenceBudgetReleaseRequestV1,
  ): Promise<InferenceBudgetReconcileOutcomeV1>;

  markReconciliationRequired(
    request: InferenceBudgetMarkReconciliationRequiredRequestV1,
  ): Promise<InferenceBudgetReconcileOutcomeV1>;

  loadPeriodLedger(
    workspaceId: WorkspaceId,
    periodKey: InferenceBudgetPeriodKeyV1,
  ): Promise<InferenceBudgetPeriodLedgerV1 | null>;

  findReservationByKey(
    workspaceId: WorkspaceId,
    reservationKey: InferenceBudgetReservationKeyV1,
  ): Promise<InferenceBudgetReservationSnapshotV1 | null>;
}

export interface InferenceBudgetRecoveryCandidateV1 {
  readonly reservation: InferenceBudgetReservationSnapshotV1;
  readonly admittedAtMs: number;
  readonly leaseLost: boolean;
}

export interface InferenceBudgetRecoveryPort {
  listRecoveryCandidates(input: {
    readonly limit: number;
    readonly now: Date;
  }): Promise<readonly InferenceBudgetRecoveryCandidateV1[]>;
}

export interface InferenceBudgetPolicyPort {
  findRuntimePolicyByWorkspaceId(
    workspaceId: WorkspaceId,
  ): Promise<InferenceBudgetRuntimePolicyV1 | null>;
}

export const INFERENCE_BUDGET_DEFAULT_UNCERTAIN_FLOOR_USD_MICROS = 0 as const;

export function createDefaultInferenceBudgetPolicyDefinition(): InferenceBudgetPolicyDefinitionV1 {
  return {
    schemaVersion: INFERENCE_BUDGET_POLICY_SCHEMA_VERSION,
    periodKind: "CALENDAR_MONTH_UTC",
    periodLimitUsdMicros: 0,
    periodEnforcement: "STRICT_PERIOD_CAP",
    unknownAdmitCostBehavior: "DENY_ADMISSION",
    onLeaseLoss: "RECONCILIATION_REQUIRED",
  };
}

export function createDefaultInferenceBudgetRuntimePolicy(): InferenceBudgetRuntimePolicyV1 {
  return {
    schemaVersion: INFERENCE_BUDGET_POLICY_SCHEMA_VERSION,
    enabled: false,
  };
}

export function createDefaultWorkspaceInferenceBudgetActivation(
  workspaceId: WorkspaceId,
  updatedAt: string,
): WorkspaceInferenceBudgetActivationV1 {
  return {
    schemaVersion: INFERENCE_BUDGET_POLICY_SCHEMA_VERSION,
    workspaceId,
    enabled: false,
    updatedAt,
  };
}

export function isInferenceBudgetTerminalReservationStatus(
  status: InferenceBudgetReservationStatus,
): status is InferenceBudgetTerminalReservationStatus {
  return (
    INFERENCE_BUDGET_TERMINAL_RESERVATION_STATUSES as readonly string[]
  ).includes(status);
}

export function defaultUncertainLiabilityFloorUsdMicros(
  policy: InferenceBudgetPolicyDefinitionV1,
  reservedUsdMicros: number,
): number {
  return (
    policy.uncertainLiabilityFloorUsdMicros ??
    reservedUsdMicros ??
    INFERENCE_BUDGET_DEFAULT_UNCERTAIN_FLOOR_USD_MICROS
  );
}

export function computeInferenceBudgetAvailableUsdMicros(
  ledger: Pick<
    InferenceBudgetPeriodLedgerV1,
    | "limitUsdMicros"
    | "committedLiabilityUsdMicros"
    | "heldReservationsUsdMicros"
    | "unresolvedUncertainLiabilityUsdMicros"
  >,
): number {
  return (
    ledger.limitUsdMicros -
    ledger.committedLiabilityUsdMicros -
    ledger.heldReservationsUsdMicros -
    ledger.unresolvedUncertainLiabilityUsdMicros
  );
}
