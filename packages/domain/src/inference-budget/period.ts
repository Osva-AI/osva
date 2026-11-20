import type {
  InferenceBudgetPeriodLedgerV1,
  InferenceBudgetPolicyVersionId,
  InferenceBudgetUtcPeriodIdentityV1,
  WorkspaceId,
} from "@osva-ai/contracts";

import { assertSafeUsdMicros } from "./usd-micros.js";

const PERIOD_KEY_PATTERN = /^(\d{4})-(0[1-9]|1[0-2])$/;

export function resolveInferenceBudgetUtcPeriodIdentity(
  instant: Date,
): InferenceBudgetUtcPeriodIdentityV1 {
  if (!(instant instanceof Date) || Number.isNaN(instant.getTime())) {
    throw new Error("instant must be a valid Date");
  }

  const year = instant.getUTCFullYear();
  const monthIndex = instant.getUTCMonth();
  const periodKey = `${year.toString().padStart(4, "0")}-${String(monthIndex + 1).padStart(2, "0")}`;

  const periodStartMs = Date.UTC(year, monthIndex, 1, 0, 0, 0, 0);
  const periodEndExclusiveMs = Date.UTC(year, monthIndex + 1, 1, 0, 0, 0, 0);

  return {
    periodKind: "CALENDAR_MONTH_UTC",
    periodKey: periodKey as InferenceBudgetUtcPeriodIdentityV1["periodKey"],
    periodStartUtc: new Date(periodStartMs).toISOString(),
    periodEndExclusiveUtc: new Date(periodEndExclusiveMs).toISOString(),
  };
}

export function parseInferenceBudgetPeriodKey(periodKey: string): {
  readonly year: number;
  readonly monthIndex: number;
} {
  const match = PERIOD_KEY_PATTERN.exec(periodKey);
  if (match === null) {
    throw new Error(`Invalid UTC period key: ${periodKey}`);
  }
  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  return { year, monthIndex };
}

export function assertInstantBelongsToPeriodKey(
  instant: Date,
  periodKey: string,
): void {
  const resolved = resolveInferenceBudgetUtcPeriodIdentity(instant);
  if (resolved.periodKey !== periodKey) {
    throw new Error(
      `Instant ${instant.toISOString()} does not belong to period ${periodKey}`,
    );
  }
}

export function createEmptyInferenceBudgetPeriodLedger(input: {
  readonly workspaceId: WorkspaceId;
  readonly period: InferenceBudgetUtcPeriodIdentityV1;
  readonly budgetPolicyVersionId: InferenceBudgetPolicyVersionId;
  readonly limitUsdMicros: number;
}): InferenceBudgetPeriodLedgerV1 {
  const limit = assertSafeUsdMicros(input.limitUsdMicros, "limitUsdMicros");
  return {
    workspaceId: input.workspaceId,
    period: input.period,
    budgetPolicyVersionId: input.budgetPolicyVersionId,
    limitUsdMicros: limit,
    committedLiabilityUsdMicros: 0,
    heldReservationsUsdMicros: 0,
    unresolvedUncertainLiabilityUsdMicros: 0,
    overageUsdMicros: 0,
  };
}
