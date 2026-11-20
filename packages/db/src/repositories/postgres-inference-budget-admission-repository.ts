import { randomUUID } from "node:crypto";

import type {
  InferenceBudgetAdmissionOutcomeV1,
  InferenceBudgetAdmissionPort,
  InferenceBudgetPeriodLedgerV1,
  InferenceBudgetAdmitOrGetExistingRequestV1,
  InferenceBudgetAllocateInvocationRequestV1,
  InferenceBudgetMarkProviderStartedRequestV1,
  InferenceBudgetMarkReconciliationRequiredRequestV1,
  InferenceBudgetPolicyDefinitionV1,
  InferenceBudgetPolicyVersionId,
  InferenceBudgetReconcileInputV1,
  InferenceBudgetReconcileOutcomeV1,
  InferenceBudgetReleaseRequestV1,
  InferenceBudgetReservationId,
  InferenceBudgetReservationSnapshotV1,
  InferenceInvocationRecordV1,
  WorkspaceId,
} from "@osva-ai/contracts";
import { InferenceBudgetProviderStartFenceError } from "@osva-ai/contracts";
import {
  assertInferenceBudgetReservationStatusTransition,
  canTransitionInferenceBudgetReservationStatus,
} from "@osva-ai/contracts";
import {
  assertRunAttemptExecutionLeaseForProviderStart,
  buildInferenceInvocationAnchorString,
  evaluateInferenceBudgetAdmission,
  evaluateInferenceBudgetReconciliation,
  markInferenceBudgetProviderStarted,
  parseInferenceBudgetPeriodKey,
  resolveInferenceBudgetUtcPeriodIdentity,
} from "@osva/domain";
import { and, eq } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import type { Database } from "../database.js";
import type * as schema from "../schema/index.js";
import {
  inferenceBudgetPeriodLedgerFromRow,
  inferenceBudgetReservationFromRow,
  inferenceInvocationFromRow,
  inferenceInvocationKindFromAnchor,
} from "../mappers/inference-budget-mapper.js";
import { PostgresInferenceBudgetPolicyRepository } from "./postgres-inference-budget-policy-repository.js";
import { mapDatabaseError } from "../postgres-errors.js";
import { inferenceBudgetReservations } from "../schema/inference-budget-reservations.js";
import { inferenceInvocations } from "../schema/inference-invocations.js";
import { runAttempts } from "../schema/run-attempts.js";
import { workspaceInferenceBudgetPeriods } from "../schema/workspace-inference-budget-periods.js";

type DbTx = PostgresJsDatabase<typeof schema>;

export class InferenceBudgetReservationTransitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InferenceBudgetReservationTransitionError";
  }
}

export class PostgresInferenceBudgetAdmissionRepository implements InferenceBudgetAdmissionPort {
  private readonly policyRepository: PostgresInferenceBudgetPolicyRepository;

  constructor(private readonly database: Database) {
    this.policyRepository = new PostgresInferenceBudgetPolicyRepository(
      database,
    );
  }

  async allocateInvocation(
    request: InferenceBudgetAllocateInvocationRequestV1,
  ): Promise<InferenceInvocationRecordV1> {
    const invocationAnchor = buildInferenceInvocationAnchorString(
      request.anchor,
    );
    const now = new Date();
    const executionGeneration =
      request.anchor.material.scope === "AGENT_RUN"
        ? request.anchor.material.executionGeneration
        : undefined;

    return this.database.db.transaction(async (tx) => {
      const inserted = await tx
        .insert(inferenceInvocations)
        .values({
          id: randomUUID(),
          workspaceId: request.workspaceId,
          invocationAnchor,
          anchorJson: request.anchor,
          invocationKind: inferenceInvocationKindFromAnchor(request.anchor),
          periodKey: request.periodKey,
          budgetPolicyVersionId: request.budgetPolicyVersionId,
          pricingSnapshotId: request.pricingSnapshotId,
          runId: request.runId,
          runAttemptId: request.runAttemptId,
          runStepId: request.runStepId,
          executionGeneration,
          lastExecutionGeneration: executionGeneration,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoNothing({
          target: [
            inferenceInvocations.workspaceId,
            inferenceInvocations.invocationAnchor,
          ],
        })
        .returning();

      if (inserted[0] !== undefined) {
        return inferenceInvocationFromRow(inserted[0]);
      }

      const [existing] = await tx
        .select()
        .from(inferenceInvocations)
        .where(
          and(
            eq(inferenceInvocations.workspaceId, request.workspaceId),
            eq(inferenceInvocations.invocationAnchor, invocationAnchor),
          ),
        )
        .limit(1);

      if (existing === undefined) {
        throw new Error("Inference invocation allocation failed.");
      }

      if (executionGeneration !== undefined) {
        await tx
          .update(inferenceInvocations)
          .set({
            lastExecutionGeneration: executionGeneration,
            ...(request.runStepId !== undefined
              ? { runStepId: request.runStepId }
              : {}),
            updatedAt: now,
          })
          .where(eq(inferenceInvocations.id, existing.id));
      }

      const [refreshed] = await tx
        .select()
        .from(inferenceInvocations)
        .where(eq(inferenceInvocations.id, existing.id))
        .limit(1);

      return inferenceInvocationFromRow(refreshed ?? existing);
    });
  }

  async admitOrGetExisting(
    request: InferenceBudgetAdmitOrGetExistingRequestV1,
  ): Promise<InferenceBudgetAdmissionOutcomeV1> {
    if (request.attempt.workspaceId !== request.workspaceId) {
      throw new Error("Workspace scope mismatch on budget admission.");
    }

    const runtime = await this.policyRepository.findRuntimePolicyByWorkspaceId(
      request.workspaceId,
    );

    if (runtime === null || !runtime.enabled) {
      return { outcome: "BYPASSED", reason: "ACTIVATION_DISABLED" };
    }
    if (runtime.definition === undefined) {
      return { outcome: "BYPASSED", reason: "POLICY_DISABLED" };
    }
    const policyDefinition = runtime.definition;

    try {
      return await this.database.db.transaction(async (tx) => {
        const existingPeek = await this.peekReservationByKey(
          tx,
          request.workspaceId,
          request.reservationKey,
        );
        if (existingPeek !== null) {
          const existing = await this.findReservationByKeyForUpdate(
            tx,
            request.workspaceId,
            request.reservationKey,
          );
          if (existing === null) {
            throw new Error(
              "Inference budget reservation disappeared after idempotent peek.",
            );
          }
          return {
            outcome: "IDEMPOTENT_EXISTING",
            reservation: existing,
          } as const;
        }

        const periodRow = await this.lockOrCreatePeriodRow(tx, {
          workspaceId: request.workspaceId,
          periodKey: request.attempt.periodKey,
          budgetPolicyVersionId: request.attempt.budgetPolicyVersionId,
          definition: policyDefinition,
        });

        const raced = await this.findReservationByKeyForUpdate(
          tx,
          request.workspaceId,
          request.reservationKey,
        );
        if (raced !== null) {
          return {
            outcome: "IDEMPOTENT_EXISTING",
            reservation: raced,
          } as const;
        }

        const periodLedger = inferenceBudgetPeriodLedgerFromRow(periodRow);
        const reservationId = randomUUID() as InferenceBudgetReservationId;
        const outcome = evaluateInferenceBudgetAdmission({
          workspaceId: request.workspaceId,
          activation: { enabled: true },
          policy: policyDefinition,
          periodLedger,
          admitCeilingUsdMicros: request.admitCeilingUsdMicros,
          reservationKey: request.reservationKey,
          newReservationId: reservationId,
          draftReservation: {
            workspaceId: request.workspaceId,
            reservationKey: request.reservationKey,
            inferenceInvocationId: request.attempt.inferenceInvocationId,
            providerAttemptIndex: request.attempt.providerAttemptIndex,
            selectedModelProfileVersionId:
              request.attempt.selectedModelProfileVersionId,
            periodKey: request.attempt.periodKey,
            budgetPolicyVersionId: request.attempt.budgetPolicyVersionId,
            pricingSnapshotId: request.attempt.pricingSnapshotId,
            runStepId: request.attempt.runStepId,
          },
        });

        if (outcome.outcome === "DENIED") {
          return outcome;
        }
        if (outcome.outcome !== "ADMITTED") {
          throw new Error(`Unexpected admission outcome: ${outcome.outcome}`);
        }

        const now = new Date();
        await tx
          .update(workspaceInferenceBudgetPeriods)
          .set({
            heldReservationsUsdMicros:
              outcome.periodLedgerAfter.heldReservationsUsdMicros,
            updatedAt: now,
          })
          .where(eq(workspaceInferenceBudgetPeriods.id, periodRow.id));

        const [reservationRow] = await tx
          .insert(inferenceBudgetReservations)
          .values({
            id: reservationId,
            workspaceId: request.workspaceId,
            reservationKey: request.reservationKey,
            inferenceInvocationId: request.attempt.inferenceInvocationId,
            providerAttemptIndex: request.attempt.providerAttemptIndex,
            selectedModelProfileVersionId:
              request.attempt.selectedModelProfileVersionId,
            periodKey: request.attempt.periodKey,
            budgetPolicyVersionId: request.attempt.budgetPolicyVersionId,
            pricingSnapshotId: request.attempt.pricingSnapshotId,
            status: "ADMITTED",
            reservedUsdMicros: outcome.reservation.reservedUsdMicros,
            runStepId: request.attempt.runStepId,
            admittedExecutionGeneration:
              request.attempt.admittedExecutionGeneration,
            createdAt: now,
            updatedAt: now,
          })
          .returning();

        if (reservationRow === undefined) {
          throw new Error("Budget reservation insert did not return a row.");
        }

        return {
          outcome: "ADMITTED",
          reservation: inferenceBudgetReservationFromRow(reservationRow),
          periodLedgerAfter: outcome.periodLedgerAfter,
        };
      });
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }

  async markProviderStarted(
    request: InferenceBudgetMarkProviderStartedRequestV1,
  ): Promise<InferenceBudgetReservationSnapshotV1> {
    return this.database.db.transaction(async (tx) => {
      const reservation = await this.lockReservationById(
        tx,
        request.workspaceId,
        request.reservationId,
      );
      if (reservation.status === "PROVIDER_STARTED") {
        return reservation;
      }
      if (reservation.status !== "ADMITTED") {
        throw new InferenceBudgetProviderStartFenceError(
          "Inference budget reservation is not eligible for provider start.",
        );
      }

      if (
        request.executionGeneration !== undefined &&
        reservation.admittedExecutionGeneration !== undefined &&
        reservation.admittedExecutionGeneration !== request.executionGeneration
      ) {
        throw new InferenceBudgetProviderStartFenceError(
          "Execution ownership generation does not match admitted reservation fence.",
        );
      }

      if (request.runAttemptId !== undefined) {
        const now = new Date();
        const [attempt] = await tx
          .select({
            status: runAttempts.status,
            executionOwner: runAttempts.executionOwner,
            executionGeneration: runAttempts.executionGeneration,
            leaseExpiresAt: runAttempts.leaseExpiresAt,
          })
          .from(runAttempts)
          .where(eq(runAttempts.id, request.runAttemptId))
          .for("update")
          .limit(1);

        if (attempt === undefined) {
          throw new InferenceBudgetProviderStartFenceError(
            "Run attempt not found for provider start fence.",
          );
        }

        assertRunAttemptExecutionLeaseForProviderStart({
          attempt,
          now,
          expectedExecutionOwner: request.executionOwner,
          expectedExecutionGeneration: request.executionGeneration,
        });
      }

      if (
        !canTransitionInferenceBudgetReservationStatus(
          reservation.status,
          "PROVIDER_STARTED",
        )
      ) {
        assertInferenceBudgetReservationStatusTransition(
          reservation.status,
          "PROVIDER_STARTED",
        );
      }

      const next = markInferenceBudgetProviderStarted({ reservation });
      const startedAt = new Date();
      const [row] = await tx
        .update(inferenceBudgetReservations)
        .set({
          status: next.status,
          providerRequestId: request.providerRequestId,
          providerStartedAt: startedAt,
          updatedAt: startedAt,
        })
        .where(
          and(
            eq(inferenceBudgetReservations.workspaceId, request.workspaceId),
            eq(inferenceBudgetReservations.id, request.reservationId),
          ),
        )
        .returning();

      if (row === undefined) {
        throw new Error("Reservation update for provider start failed.");
      }
      return inferenceBudgetReservationFromRow(row);
    });
  }

  async reconcile(
    request: InferenceBudgetReconcileInputV1,
  ): Promise<InferenceBudgetReconcileOutcomeV1> {
    return this.applyLedgerTransition(request);
  }

  async release(
    request: InferenceBudgetReleaseRequestV1,
  ): Promise<InferenceBudgetReconcileOutcomeV1> {
    return this.applyLedgerTransition({
      workspaceId: request.workspaceId,
      reservation: request.reservation,
      periodLedger: request.periodLedger,
      committedUsdMicros: null,
      usageKnown: false,
      providerAccepted: false,
      billableProviderOutcome: false,
      nonBillableCancelBeforeAccept: true,
    });
  }

  async markReconciliationRequired(
    request: InferenceBudgetMarkReconciliationRequiredRequestV1,
  ): Promise<InferenceBudgetReconcileOutcomeV1> {
    const runtime = await this.policyRepository.findRuntimePolicyByWorkspaceId(
      request.workspaceId,
    );
    return this.applyLedgerTransition({
      workspaceId: request.workspaceId,
      reservation: request.reservation,
      periodLedger: request.periodLedger,
      committedUsdMicros: null,
      usageKnown: false,
      providerAccepted: true,
      billableProviderOutcome: true,
      policy: runtime?.definition,
    });
  }

  async findReservationByKey(
    workspaceId: WorkspaceId,
    reservationKey: string,
  ): Promise<InferenceBudgetReservationSnapshotV1 | null> {
    const [row] = await this.database.db
      .select()
      .from(inferenceBudgetReservations)
      .where(
        and(
          eq(inferenceBudgetReservations.workspaceId, workspaceId),
          eq(inferenceBudgetReservations.reservationKey, reservationKey),
        ),
      )
      .limit(1);
    return row === undefined ? null : inferenceBudgetReservationFromRow(row);
  }

  async loadPeriodLedger(
    workspaceId: WorkspaceId,
    periodKey: InferenceBudgetReservationSnapshotV1["periodKey"],
  ): Promise<InferenceBudgetPeriodLedgerV1 | null> {
    const [row] = await this.database.db
      .select()
      .from(workspaceInferenceBudgetPeriods)
      .where(
        and(
          eq(workspaceInferenceBudgetPeriods.workspaceId, workspaceId),
          eq(workspaceInferenceBudgetPeriods.periodKey, periodKey),
        ),
      )
      .limit(1);
    return row === undefined ? null : inferenceBudgetPeriodLedgerFromRow(row);
  }

  async listUnresolvedReconciliationCandidates(
    workspaceId: WorkspaceId,
  ): Promise<readonly InferenceBudgetReservationSnapshotV1[]> {
    const rows = await this.database.db
      .select()
      .from(inferenceBudgetReservations)
      .where(and(eq(inferenceBudgetReservations.workspaceId, workspaceId)));
    return rows
      .filter(
        (row) =>
          row.status === "RECONCILIATION_REQUIRED" ||
          row.status === "PROVIDER_STARTED",
      )
      .map(inferenceBudgetReservationFromRow);
  }

  private async applyLedgerTransition(
    request: InferenceBudgetReconcileInputV1 & {
      readonly policy?: InferenceBudgetPolicyDefinitionV1;
    },
  ): Promise<InferenceBudgetReconcileOutcomeV1> {
    if (request.reservation.workspaceId !== request.workspaceId) {
      throw new Error("Reservation workspace mismatch.");
    }

    const expectedPeriodKey = request.reservation.periodKey;
    const expectedReservationId = request.reservation.id;

    return this.database.db.transaction(async (tx) => {
      const reservationPeek = await this.peekReservationById(
        tx,
        request.workspaceId,
        expectedReservationId,
      );
      if (reservationPeek === null) {
        throw new Error("Inference budget reservation not found.");
      }
      if (reservationPeek.periodKey !== expectedPeriodKey) {
        throw new Error("Reservation period identity mismatch.");
      }
      if (reservationPeek.workspaceId !== request.workspaceId) {
        throw new Error("Reservation workspace mismatch after peek.");
      }

      const periodRow = await this.lockPeriodRow(
        tx,
        request.workspaceId,
        expectedPeriodKey,
      );
      if (periodRow === null) {
        throw new Error("Budget period row missing for reconciliation.");
      }

      const lockedReservation = await this.lockReservationById(
        tx,
        request.workspaceId,
        expectedReservationId,
      );

      if (lockedReservation.periodKey !== expectedPeriodKey) {
        throw new Error("Reservation period identity changed under lock.");
      }
      if (lockedReservation.workspaceId !== request.workspaceId) {
        throw new Error("Reservation workspace mismatch under lock.");
      }
      if (lockedReservation.id !== expectedReservationId) {
        throw new Error("Reservation identity mismatch under lock.");
      }

      const outcome = evaluateInferenceBudgetReconciliation({
        ...request,
        reservation: lockedReservation,
        periodLedger: inferenceBudgetPeriodLedgerFromRow(periodRow),
      });

      if (
        outcome.nextStatus !== lockedReservation.status &&
        !canTransitionInferenceBudgetReservationStatus(
          lockedReservation.status,
          outcome.nextStatus,
        )
      ) {
        throw new InferenceBudgetReservationTransitionError(
          `Illegal inference budget reservation status transition: ${lockedReservation.status} -> ${outcome.nextStatus}`,
        );
      }

      const now = new Date();
      await tx
        .update(workspaceInferenceBudgetPeriods)
        .set({
          committedLiabilityUsdMicros:
            outcome.periodLedgerAfter.committedLiabilityUsdMicros,
          heldReservationsUsdMicros:
            outcome.periodLedgerAfter.heldReservationsUsdMicros,
          unresolvedUncertainLiabilityUsdMicros:
            outcome.periodLedgerAfter.unresolvedUncertainLiabilityUsdMicros,
          overageUsdMicros: outcome.periodLedgerAfter.overageUsdMicros,
          updatedAt: now,
        })
        .where(eq(workspaceInferenceBudgetPeriods.id, periodRow.id));

      await tx
        .update(inferenceBudgetReservations)
        .set({
          status: outcome.reservationAfter.status,
          committedUsdMicros:
            outcome.reservationAfter.committedUsdMicros ?? null,
          uncertainFloorUsdMicros:
            outcome.reservationAfter.uncertainFloorUsdMicros ?? null,
          updatedAt: now,
        })
        .where(eq(inferenceBudgetReservations.id, lockedReservation.id));

      return outcome;
    });
  }

  private async peekReservationByKey(
    tx: DbTx,
    workspaceId: WorkspaceId,
    reservationKey: string,
  ): Promise<InferenceBudgetReservationSnapshotV1 | null> {
    const [row] = await tx
      .select()
      .from(inferenceBudgetReservations)
      .where(
        and(
          eq(inferenceBudgetReservations.workspaceId, workspaceId),
          eq(inferenceBudgetReservations.reservationKey, reservationKey),
        ),
      )
      .limit(1);
    return row === undefined ? null : inferenceBudgetReservationFromRow(row);
  }

  private async peekReservationById(
    tx: DbTx,
    workspaceId: WorkspaceId,
    reservationId: InferenceBudgetReservationId,
  ): Promise<InferenceBudgetReservationSnapshotV1 | null> {
    const [row] = await tx
      .select()
      .from(inferenceBudgetReservations)
      .where(
        and(
          eq(inferenceBudgetReservations.workspaceId, workspaceId),
          eq(inferenceBudgetReservations.id, reservationId),
        ),
      )
      .limit(1);
    return row === undefined ? null : inferenceBudgetReservationFromRow(row);
  }

  private async findReservationByKeyForUpdate(
    tx: DbTx,
    workspaceId: WorkspaceId,
    reservationKey: string,
  ): Promise<InferenceBudgetReservationSnapshotV1 | null> {
    const [row] = await tx
      .select()
      .from(inferenceBudgetReservations)
      .where(
        and(
          eq(inferenceBudgetReservations.workspaceId, workspaceId),
          eq(inferenceBudgetReservations.reservationKey, reservationKey),
        ),
      )
      .for("update")
      .limit(1);
    return row === undefined ? null : inferenceBudgetReservationFromRow(row);
  }

  private async lockReservationById(
    tx: DbTx,
    workspaceId: WorkspaceId,
    reservationId: InferenceBudgetReservationId,
  ): Promise<InferenceBudgetReservationSnapshotV1> {
    const [row] = await tx
      .select()
      .from(inferenceBudgetReservations)
      .where(
        and(
          eq(inferenceBudgetReservations.workspaceId, workspaceId),
          eq(inferenceBudgetReservations.id, reservationId),
        ),
      )
      .for("update")
      .limit(1);

    if (row === undefined) {
      throw new Error("Inference budget reservation not found.");
    }
    return inferenceBudgetReservationFromRow(row);
  }

  private async lockPeriodRow(
    tx: DbTx,
    workspaceId: WorkspaceId,
    periodKey: string,
  ) {
    const [row] = await tx
      .select()
      .from(workspaceInferenceBudgetPeriods)
      .where(
        and(
          eq(workspaceInferenceBudgetPeriods.workspaceId, workspaceId),
          eq(workspaceInferenceBudgetPeriods.periodKey, periodKey),
        ),
      )
      .for("update")
      .limit(1);
    return row ?? null;
  }

  private async lockOrCreatePeriodRow(
    tx: DbTx,
    input: {
      readonly workspaceId: WorkspaceId;
      readonly periodKey: string;
      readonly budgetPolicyVersionId: InferenceBudgetPolicyVersionId;
      readonly definition: InferenceBudgetPolicyDefinitionV1;
    },
  ) {
    const { year, monthIndex } = parseInferenceBudgetPeriodKey(input.periodKey);
    const identity = resolveInferenceBudgetUtcPeriodIdentity(
      new Date(Date.UTC(year, monthIndex, 15, 12, 0, 0, 0)),
    );
    const now = new Date();

    await tx
      .insert(workspaceInferenceBudgetPeriods)
      .values({
        id: randomUUID(),
        workspaceId: input.workspaceId,
        periodKind: identity.periodKind,
        periodKey: input.periodKey,
        periodStartUtc: new Date(identity.periodStartUtc),
        periodEndExclusiveUtc: new Date(identity.periodEndExclusiveUtc),
        budgetPolicyVersionId: input.budgetPolicyVersionId,
        limitUsdMicros: input.definition.periodLimitUsdMicros,
        committedLiabilityUsdMicros: 0,
        heldReservationsUsdMicros: 0,
        unresolvedUncertainLiabilityUsdMicros: 0,
        overageUsdMicros: 0,
        schemaVersion: 1,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing({
        target: [
          workspaceInferenceBudgetPeriods.workspaceId,
          workspaceInferenceBudgetPeriods.periodKey,
        ],
      });

    const locked = await this.lockPeriodRow(
      tx,
      input.workspaceId,
      input.periodKey,
    );
    if (locked === null) {
      throw new Error("Failed to lock workspace inference budget period.");
    }
    return locked;
  }
}
