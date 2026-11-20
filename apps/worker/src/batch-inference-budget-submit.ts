import {
  INFERENCE_INVOCATION_ANCHOR_FORMAT_VERSION,
  type BatchInferenceItemId,
  type InferenceBudgetAdmissionOutcomeV1,
  type InferenceBudgetPeriodLedgerV1,
  type InferenceBudgetReservationSnapshotV1,
  type InferenceBudgetRuntimePolicyV1,
} from "@osva-ai/contracts";
import {
  estimateRoutingInputTokens,
  estimateRoutingPreflightCostUsdMicros,
} from "@osva-ai/contracts";
import type { InferenceBudgetAdmissionPort } from "@osva-ai/contracts";
import {
  buildInferenceInvocationAnchorString,
  deriveInferenceBudgetReservationKey,
  mergeTrustedInferenceBudgetRuntimePolicy,
  resolveInferenceBudgetAdmitCeilingUsdMicros,
  resolveInferenceBudgetUtcPeriodIdentity,
} from "@osva/domain";
import type {
  BatchInferenceItemRecord,
  BatchInferenceJobRecord,
  ModelProfileVersion,
} from "@osva/domain";
import type { PostgresInferenceBudgetPolicyRepository } from "@osva/db";
import { createEmptyInferenceBudgetPeriodLedger } from "@osva/domain";
import { parseInferenceBudgetPeriodKey } from "@osva/domain";

interface AdmittedBatchItemV1 {
  readonly itemId: BatchInferenceItemId;
  readonly reservation: InferenceBudgetReservationSnapshotV1;
  readonly periodLedger: InferenceBudgetPeriodLedgerV1;
}

export type BatchInferenceSubmitBudgetOutcomeV1 =
  | { readonly kind: "BYPASS" }
  | { readonly kind: "DENIED"; readonly code: string }
  | {
      readonly kind: "ADMITTED";
      readonly session: BatchInferenceSubmitBudgetSessionV1;
    };

export interface BatchInferenceSubmitBudgetSessionV1 {
  /** Call after all items are ADMITTED and before provider HTTP submit. */
  readonly markAllProviderStartedBeforeSubmit: () => Promise<void>;
  /** Release holds that never reached provider submit. */
  readonly rollbackNeverSubmitted: () => Promise<void>;
  /** Retain liability when provider acceptance or charges are uncertain. */
  readonly markSubmitUncertain: () => Promise<void>;
}

export async function admitBatchInferenceSubmitBudget(input: {
  readonly policies: PostgresInferenceBudgetPolicyRepository;
  readonly admission: InferenceBudgetAdmissionPort;
  readonly job: BatchInferenceJobRecord;
  readonly items: readonly BatchInferenceItemRecord[];
  readonly modelProfileVersion: ModelProfileVersion;
  readonly now?: Date;
}): Promise<BatchInferenceSubmitBudgetOutcomeV1> {
  const runtime = await input.policies.findRuntimePolicyByWorkspaceId(
    input.job.workspaceId,
  );
  const merged = mergeTrustedInferenceBudgetRuntimePolicy(
    runtime as InferenceBudgetRuntimePolicyV1 | undefined,
  );
  if (merged.enabled !== true || merged.policyVersionId === undefined) {
    return { kind: "BYPASS" };
  }

  const policyDefinition = merged.definition;
  const policyVersionId = merged.policyVersionId;
  if (policyDefinition === undefined || policyVersionId === undefined) {
    return { kind: "DENIED", code: "budget_policy_unavailable" };
  }

  const now = input.now ?? new Date();
  const period = resolveInferenceBudgetUtcPeriodIdentity(now);
  const pricing = input.modelProfileVersion.pricing;
  const admitted: AdmittedBatchItemV1[] = [];

  try {
    for (const item of input.items) {
      const anchor = {
        anchorFormatVersion: INFERENCE_INVOCATION_ANCHOR_FORMAT_VERSION,
        workspaceId: input.job.workspaceId,
        invocationKind: "BATCH" as const,
        material: {
          scope: "BATCH_INFERENCE" as const,
          batchInferenceItemId: item.id,
        },
      };

      const invocation = await input.admission.allocateInvocation({
        workspaceId: input.job.workspaceId,
        anchor,
        periodKey: period.periodKey,
        budgetPolicyVersionId: policyVersionId,
        pricingSnapshotId:
          input.job.pricingSnapshotId ??
          `mpv:${input.job.modelProfileVersionId}`,
      });

      const reservationKey = deriveInferenceBudgetReservationKey({
        version: "1",
        inferenceInvocationId: invocation.id,
        providerAttemptIndex: 0,
        selectedModelProfileVersionId: input.job.modelProfileVersionId,
      });

      const inputTokens = estimateRoutingInputTokens(item.input.messages ?? []);
      const preflight =
        pricing === undefined
          ? null
          : estimateRoutingPreflightCostUsdMicros({
              estimatedInputTokens: inputTokens,
              maxOutputTokens: item.input.maxOutputTokens,
              pricing,
            }).estimatedCostUsdMicros;

      const admitCeiling = resolveInferenceBudgetAdmitCeilingUsdMicros({
        policy: policyDefinition,
        admitCeilingUsdMicros: preflight,
      });

      if (admitCeiling === null) {
        await rollbackAdmitted(input.admission, admitted);
        return { kind: "DENIED", code: "budget_admit_ceiling_unresolved" };
      }

      let admission: InferenceBudgetAdmissionOutcomeV1;
      try {
        admission = await input.admission.admitOrGetExisting({
          workspaceId: input.job.workspaceId,
          reservationKey,
          admitCeilingUsdMicros: admitCeiling,
          attempt: {
            workspaceId: input.job.workspaceId,
            inferenceInvocationId: invocation.id,
            invocationAnchor: buildInferenceInvocationAnchorString(anchor),
            periodKey: period.periodKey,
            budgetPolicyVersionId: policyVersionId,
            pricingSnapshotId:
              input.job.pricingSnapshotId ??
              `mpv:${input.job.modelProfileVersionId}`,
            providerAttemptIndex: 0,
            selectedModelProfileVersionId: input.job.modelProfileVersionId,
            admitCeilingUsdMicros: admitCeiling,
          },
        });
      } catch {
        await rollbackAdmitted(input.admission, admitted);
        return { kind: "DENIED", code: "budget_admission_unavailable" };
      }

      if (admission.outcome === "DENIED") {
        await rollbackAdmitted(input.admission, admitted);
        return { kind: "DENIED", code: "budget_period_exhausted" };
      }

      if (admission.outcome === "BYPASSED") {
        await rollbackAdmitted(input.admission, admitted);
        return { kind: "BYPASS" };
      }

      const reservation =
        admission.outcome === "ADMITTED" ||
        admission.outcome === "IDEMPOTENT_EXISTING"
          ? admission.reservation
          : undefined;
      if (reservation === undefined || reservation.status !== "ADMITTED") {
        await rollbackAdmitted(input.admission, admitted);
        return { kind: "DENIED", code: "budget_reservation_ineligible" };
      }

      const { year, monthIndex } = parseInferenceBudgetPeriodKey(
        reservation.periodKey,
      );
      const periodIdentity = resolveInferenceBudgetUtcPeriodIdentity(
        new Date(Date.UTC(year, monthIndex, 15, 12, 0, 0, 0)),
      );
      const periodLedger =
        admission.outcome === "ADMITTED"
          ? admission.periodLedgerAfter
          : createEmptyInferenceBudgetPeriodLedger({
              workspaceId: input.job.workspaceId,
              period: periodIdentity,
              budgetPolicyVersionId: reservation.budgetPolicyVersionId,
              limitUsdMicros: policyDefinition.periodLimitUsdMicros,
            });

      admitted.push({ itemId: item.id, reservation, periodLedger });
    }
  } catch {
    await rollbackAdmitted(input.admission, admitted);
    return { kind: "DENIED", code: "budget_admission_failed" };
  }

  const session: BatchInferenceSubmitBudgetSessionV1 = {
    markAllProviderStartedBeforeSubmit: async () => {
      for (let index = 0; index < admitted.length; index += 1) {
        const row = admitted[index]!;
        try {
          const reservation = await input.admission.markProviderStarted({
            workspaceId: input.job.workspaceId,
            reservationId: row.reservation.id,
          });
          admitted[index] = { ...row, reservation };
        } catch (error) {
          for (const partial of admitted) {
            if (partial.reservation.status === "PROVIDER_STARTED") {
              try {
                await input.admission.markReconciliationRequired({
                  workspaceId: input.job.workspaceId,
                  reservation: partial.reservation,
                  periodLedger: partial.periodLedger,
                });
              } catch {
                // Retain liability.
              }
            }
          }
          await rollbackAdmitted(input.admission, admitted);
          throw error;
        }
      }
    },
    rollbackNeverSubmitted: async () => {
      await rollbackAdmitted(input.admission, admitted);
    },
    markSubmitUncertain: async () => {
      for (const row of admitted) {
        try {
          await input.admission.markReconciliationRequired({
            workspaceId: input.job.workspaceId,
            reservation: row.reservation,
            periodLedger: row.periodLedger,
          });
        } catch {
          // Retain liability; reconciliation tick may recover.
        }
      }
    },
  };

  return { kind: "ADMITTED", session };
}

export async function reconcileBatchInferenceItemBudget(input: {
  readonly policies: PostgresInferenceBudgetPolicyRepository;
  readonly admission: InferenceBudgetAdmissionPort;
  readonly job: BatchInferenceJobRecord;
  readonly item: BatchInferenceItemRecord;
  readonly estimatedCostMicros: number | undefined;
  readonly usageKnown: boolean;
  readonly billableProviderOutcome: boolean;
  readonly cancelled: boolean;
}): Promise<void> {
  const runtime = await input.policies.findRuntimePolicyByWorkspaceId(
    input.job.workspaceId,
  );
  const merged = mergeTrustedInferenceBudgetRuntimePolicy(
    runtime as InferenceBudgetRuntimePolicyV1 | undefined,
  );
  if (merged.enabled !== true || merged.policyVersionId === undefined) {
    return;
  }
  const anchor = {
    anchorFormatVersion: INFERENCE_INVOCATION_ANCHOR_FORMAT_VERSION,
    workspaceId: input.job.workspaceId,
    invocationKind: "BATCH" as const,
    material: {
      scope: "BATCH_INFERENCE" as const,
      batchInferenceItemId: input.item.id,
    },
  };

  const period = resolveInferenceBudgetUtcPeriodIdentity(new Date());
  let invocation;
  try {
    invocation = await input.admission.allocateInvocation({
      workspaceId: input.job.workspaceId,
      anchor,
      periodKey: period.periodKey,
      budgetPolicyVersionId: merged.policyVersionId,
      pricingSnapshotId:
        input.job.pricingSnapshotId ?? `mpv:${input.job.modelProfileVersionId}`,
    });
  } catch {
    return;
  }

  const reservationKey = deriveInferenceBudgetReservationKey({
    version: "1",
    inferenceInvocationId: invocation.id,
    providerAttemptIndex: 0,
    selectedModelProfileVersionId: input.job.modelProfileVersionId,
  });

  const reservation = await input.admission.findReservationByKey(
    input.job.workspaceId,
    reservationKey,
  );
  if (reservation === null) {
    return;
  }

  if (reservation.status === "RELEASED" || reservation.status === "COMMITTED") {
    return;
  }

  const ledger = await input.admission.loadPeriodLedger(
    input.job.workspaceId,
    reservation.periodKey,
  );
  if (ledger === null) {
    return;
  }

  if (
    !input.usageKnown &&
    (input.cancelled || reservation.status === "PROVIDER_STARTED")
  ) {
    await input.admission.markReconciliationRequired({
      workspaceId: input.job.workspaceId,
      reservation,
      periodLedger: ledger,
    });
    return;
  }

  await input.admission.reconcile({
    workspaceId: input.job.workspaceId,
    reservation,
    periodLedger: ledger,
    committedUsdMicros: input.estimatedCostMicros ?? null,
    usageKnown: input.usageKnown,
    providerAccepted: true,
    billableProviderOutcome: input.billableProviderOutcome,
  });
}

async function rollbackAdmitted(
  admission: InferenceBudgetAdmissionPort,
  admitted: readonly AdmittedBatchItemV1[],
): Promise<void> {
  for (const row of [...admitted].reverse()) {
    if (row.reservation.status !== "ADMITTED") {
      continue;
    }
    try {
      await admission.release({
        workspaceId: row.reservation.workspaceId,
        reservation: row.reservation,
        periodLedger: row.periodLedger,
      });
    } catch {
      // Fail closed on ambiguous release; recovery tick handles stale holds.
    }
  }
}
