import {
  INFERENCE_BUDGET_POLICY_SCHEMA_VERSION,
  INFERENCE_BUDGET_RESERVATION_STATUSES,
  assertInferenceBudgetReservationStatusTransition,
  canTransitionInferenceBudgetReservationStatus,
  createDefaultInferenceBudgetPolicyDefinition,
  createDefaultInferenceBudgetRuntimePolicy,
  isInferenceBudgetNonFallbackErrorCode,
  isInferenceBudgetNonRetryableErrorCode,
  parseInferenceBudgetPolicyDefinition,
} from "@osva-ai/contracts";
import { describe, expect, it } from "vitest";

describe("inference budget contracts", () => {
  it("C1: policy defaults and validation", () => {
    const policy = createDefaultInferenceBudgetPolicyDefinition();
    expect(policy.schemaVersion).toBe(INFERENCE_BUDGET_POLICY_SCHEMA_VERSION);
    expect(policy.periodEnforcement).toBe("STRICT_PERIOD_CAP");
    expect(policy.unknownAdmitCostBehavior).toBe("DENY_ADMISSION");
    expect(parseInferenceBudgetPolicyDefinition(policy)).toEqual(policy);
    expect(() =>
      parseInferenceBudgetPolicyDefinition({
        ...policy,
        unknownAdmitCostBehavior: "USE_POLICY_FLOOR_USD_MICROS",
      }),
    ).toThrow();
  });

  it("defaults runtime policy to disabled", () => {
    expect(createDefaultInferenceBudgetRuntimePolicy()).toEqual({
      schemaVersion: "1",
      enabled: false,
    });
  });

  it("C10: illegal lifecycle transitions are rejected", () => {
    expect(
      canTransitionInferenceBudgetReservationStatus("COMMITTED", "RELEASED"),
    ).toBe(false);
    expect(() =>
      assertInferenceBudgetReservationStatusTransition("COMMITTED", "RELEASED"),
    ).toThrow(/Illegal inference budget reservation status transition/);
    expect(INFERENCE_BUDGET_RESERVATION_STATUSES).toContain(
      "RECONCILIATION_REQUIRED",
    );
  });

  it("C18: budget exceeded is non-retryable and non-fallback", () => {
    expect(
      isInferenceBudgetNonRetryableErrorCode("MODEL_INFERENCE_BUDGET_EXCEEDED"),
    ).toBe(true);
    expect(
      isInferenceBudgetNonFallbackErrorCode("MODEL_INFERENCE_BUDGET_EXCEEDED"),
    ).toBe(true);
  });
});
