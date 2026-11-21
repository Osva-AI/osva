import type {
  InferenceBudgetPeriodKeyV1,
  InferenceBudgetReservationKeyV1,
  InferenceBudgetRuntimePolicyV1,
  InferenceInvocationAnchorContractV1,
  InferenceInvocationKind,
  ModelProfileVersionId,
  RunAttemptId,
  RunId,
  RunStepId,
  WorkspaceId,
} from "@osva-ai/contracts";
import type { InferenceBudgetAdmissionPort } from "@osva-ai/contracts";
import type { ModelGatewayGenerateTextOptions } from "./provider-adapter.js";

export interface TrustedModelGatewayBudgetBindingV1 {
  readonly enforcement: "ENABLED";
  readonly workspaceId: WorkspaceId;
  readonly admission: InferenceBudgetAdmissionPort;
  readonly runtimePolicy: InferenceBudgetRuntimePolicyV1;
  readonly anchor: InferenceInvocationAnchorContractV1;
  readonly periodKey: InferenceBudgetPeriodKeyV1;
  readonly pricingSnapshotId: string;
  readonly runId?: RunId;
  readonly runAttemptId?: RunAttemptId;
  readonly runStepId?: RunStepId;
  readonly invocationKind: InferenceInvocationKind;
  /**
   * Populated by routing for each provider attempt before I/O.
   */
  readonly providerAttemptIndex?: number;
  readonly selectedModelProfileVersionId?: ModelProfileVersionId;
  readonly reservationKey?: InferenceBudgetReservationKeyV1;
  readonly executionGenerationFence?: number;
  readonly executionOwner?: string;
}

export type ModelGatewayBudgetContext =
  | { readonly enforcement: "DISABLED" }
  | { readonly enforcement: "FAIL_CLOSED" }
  | TrustedModelGatewayBudgetBindingV1;

export function isModelGatewayBudgetEnforced(
  budget: ModelGatewayBudgetContext | undefined,
): budget is TrustedModelGatewayBudgetBindingV1 {
  return budget?.enforcement === "ENABLED";
}

export function isModelGatewayBudgetFailClosed(
  budget: ModelGatewayBudgetContext | undefined,
): budget is { readonly enforcement: "FAIL_CLOSED" } {
  return budget?.enforcement === "FAIL_CLOSED";
}

export function mergeProviderAttemptBudgetOptions(
  base: ModelGatewayGenerateTextOptions | undefined,
  attempt: {
    readonly providerAttemptIndex: number;
    readonly selectedModelProfileVersionId: ModelProfileVersionId;
  },
): ModelGatewayGenerateTextOptions | undefined {
  if (base === undefined) {
    return undefined;
  }
  if (base.budget === undefined || base.budget.enforcement !== "ENABLED") {
    return base;
  }
  return {
    ...base,
    budget: {
      ...base.budget,
      providerAttemptIndex: attempt.providerAttemptIndex,
      selectedModelProfileVersionId: attempt.selectedModelProfileVersionId,
    },
  };
}
