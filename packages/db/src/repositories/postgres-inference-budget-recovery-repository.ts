import type {
  InferenceBudgetRecoveryCandidateV1,
  InferenceBudgetRecoveryPort,
  InferenceBudgetReservationId,
  InferenceBudgetReservationSnapshotV1,
  WorkspaceId,
} from "@osva-ai/contracts";
import { and, eq, inArray, lte } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import type { Database } from "../database.js";
import type * as schema from "../schema/index.js";
import { inferenceBudgetReservationFromRow } from "../mappers/inference-budget-mapper.js";
import { inferenceBudgetReservations } from "../schema/inference-budget-reservations.js";
import { inferenceInvocations } from "../schema/inference-invocations.js";
import { runAttempts } from "../schema/run-attempts.js";

type DbTx = PostgresJsDatabase<typeof schema>;

export class PostgresInferenceBudgetRecoveryRepository implements InferenceBudgetRecoveryPort {
  constructor(private readonly database: Database) {}

  async listRecoveryCandidates(input: {
    readonly limit: number;
    readonly now: Date;
  }): Promise<InferenceBudgetRecoveryCandidateV1[]> {
    const rows = await this.database.db
      .select({
        reservation: inferenceBudgetReservations,
        runAttemptLeaseExpiresAt: runAttempts.leaseExpiresAt,
        runAttemptExecutionGeneration: runAttempts.executionGeneration,
      })
      .from(inferenceBudgetReservations)
      .innerJoin(
        inferenceInvocations,
        eq(
          inferenceBudgetReservations.inferenceInvocationId,
          inferenceInvocations.id,
        ),
      )
      .leftJoin(
        runAttempts,
        eq(inferenceInvocations.runAttemptId, runAttempts.id),
      )
      .where(
        inArray(inferenceBudgetReservations.status, [
          "ADMITTED",
          "PROVIDER_STARTED",
          "RECONCILIATION_REQUIRED",
        ]),
      )
      .orderBy(inferenceBudgetReservations.createdAt)
      .limit(input.limit);

    return rows.map((row) => {
      const leaseLost =
        row.runAttemptLeaseExpiresAt !== null &&
        row.runAttemptLeaseExpiresAt <= input.now;
      return {
        reservation: inferenceBudgetReservationFromRow(row.reservation),
        admittedAtMs: row.reservation.createdAt.getTime(),
        leaseLost,
      };
    });
  }

  async listStaleAdmitted(input: {
    readonly workspaceId: WorkspaceId;
    readonly olderThan: Date;
    readonly limit: number;
  }): Promise<InferenceBudgetReservationSnapshotV1[]> {
    const rows = await this.database.db
      .select()
      .from(inferenceBudgetReservations)
      .where(
        and(
          eq(inferenceBudgetReservations.workspaceId, input.workspaceId),
          eq(inferenceBudgetReservations.status, "ADMITTED"),
          lte(inferenceBudgetReservations.createdAt, input.olderThan),
        ),
      )
      .limit(input.limit);
    return rows.map((row) => inferenceBudgetReservationFromRow(row));
  }

  async loadReservationsByIds(
    tx: DbTx,
    workspaceId: WorkspaceId,
    reservationIds: readonly InferenceBudgetReservationId[],
  ): Promise<InferenceBudgetReservationSnapshotV1[]> {
    if (reservationIds.length === 0) {
      return [];
    }
    const rows = await tx
      .select()
      .from(inferenceBudgetReservations)
      .where(
        and(
          eq(inferenceBudgetReservations.workspaceId, workspaceId),
          inArray(inferenceBudgetReservations.id, [...reservationIds]),
        ),
      );
    return rows.map((row) => inferenceBudgetReservationFromRow(row));
  }
}
