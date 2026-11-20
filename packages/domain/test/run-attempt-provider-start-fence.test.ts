import { InferenceBudgetProviderStartFenceError } from "@osva-ai/contracts";
import { assertRunAttemptExecutionLeaseForProviderStart } from "@osva/domain";
import { describe, expect, it } from "vitest";

describe("assertRunAttemptExecutionLeaseForProviderStart", () => {
  const now = new Date("2026-01-15T12:00:00.000Z");

  it("allows an active RUNNING lease with matching owner and generation", () => {
    expect(() =>
      assertRunAttemptExecutionLeaseForProviderStart({
        attempt: {
          status: "RUNNING",
          executionOwner: "worker:abc",
          executionGeneration: 3,
          leaseExpiresAt: new Date("2026-01-15T12:05:00.000Z"),
        },
        now,
        expectedExecutionOwner: "worker:abc",
        expectedExecutionGeneration: 3,
      }),
    ).not.toThrow();
  });

  it("E14: rejects an expired execution lease", () => {
    expect(() =>
      assertRunAttemptExecutionLeaseForProviderStart({
        attempt: {
          status: "RUNNING",
          executionOwner: "worker:abc",
          executionGeneration: 3,
          leaseExpiresAt: new Date("2026-01-15T11:59:00.000Z"),
        },
        now,
        expectedExecutionOwner: "worker:abc",
        expectedExecutionGeneration: 3,
      }),
    ).toThrow(InferenceBudgetProviderStartFenceError);
  });

  it("E15: rejects a stale execution generation", () => {
    expect(() =>
      assertRunAttemptExecutionLeaseForProviderStart({
        attempt: {
          status: "RUNNING",
          executionOwner: "worker:abc",
          executionGeneration: 4,
          leaseExpiresAt: new Date("2026-01-15T12:05:00.000Z"),
        },
        now,
        expectedExecutionOwner: "worker:abc",
        expectedExecutionGeneration: 3,
      }),
    ).toThrow(InferenceBudgetProviderStartFenceError);
  });
});
