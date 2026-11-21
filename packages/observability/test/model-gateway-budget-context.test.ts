import type { ExecutionRequest, WorkspaceId } from "@osva-ai/contracts";
import type { InferenceBudgetAdmissionPort } from "@osva-ai/contracts";
import { describe, expect, it, vi } from "vitest";

import { resolveModelGatewayBudgetContextAsync } from "../src/model-gateway-budget-context.js";

describe("resolveModelGatewayBudgetContextAsync", () => {
  const workspaceId = "ws-trusted" as WorkspaceId;
  const execution = {
    workspaceId,
    runId: "run-1",
    runAttemptId: "rat-1",
    policyContext: {
      inferenceBudget: { schemaVersion: "1", enabled: false },
    },
  } as unknown as ExecutionRequest;

  it("S7: trusted workspace policy overrides disabled agent policyContext", async () => {
    const admission = {} as InferenceBudgetAdmissionPort;
    const budget = await resolveModelGatewayBudgetContextAsync({
      execution,
      admission,
      bindingName: "main",
      modelProfileVersionId: "mpv-1" as never,
      invocationKind: "SYNC",
      resolveTrustedWorkspacePolicy: vi.fn(async () => ({
        schemaVersion: "1",
        enabled: true,
        policyVersionId: "ibpv-1" as never,
        definition: {
          schemaVersion: "1",
          periodKind: "CALENDAR_MONTH_UTC",
          periodLimitUsdMicros: 1_000_000,
          periodEnforcement: "STRICT_PERIOD_CAP",
          unknownAdmitCostBehavior: "DENY_ADMISSION",
          onLeaseLoss: "RECONCILIATION_REQUIRED",
        },
      })) as never,
    });
    expect(budget).toMatchObject({ enforcement: "ENABLED" });
  });

  it("S6: returns FAIL_CLOSED when policy enabled but admission missing", async () => {
    const budget = await resolveModelGatewayBudgetContextAsync({
      execution,
      admission: undefined,
      bindingName: "main",
      modelProfileVersionId: "mpv-1" as never,
      invocationKind: "SYNC",
      resolveTrustedWorkspacePolicy: vi.fn(async () => ({
        schemaVersion: "1",
        enabled: true,
        policyVersionId: "ibpv-1" as never,
        definition: {
          schemaVersion: "1",
          periodKind: "CALENDAR_MONTH_UTC",
          periodLimitUsdMicros: 1_000_000,
          periodEnforcement: "STRICT_PERIOD_CAP",
          unknownAdmitCostBehavior: "DENY_ADMISSION",
          onLeaseLoss: "RECONCILIATION_REQUIRED",
        },
      })) as never,
    });
    expect(budget).toEqual({ enforcement: "FAIL_CLOSED" });
  });
});
