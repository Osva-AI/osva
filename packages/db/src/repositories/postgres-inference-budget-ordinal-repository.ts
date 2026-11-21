import { randomUUID } from "node:crypto";

import type {
  InferenceBudgetAllocateModelInvocationOrdinalRequestV1,
  InferenceBudgetInvocationOrdinalPort,
  InferenceBudgetModelInvocationOrdinalV1,
  RunAttemptId,
  WorkspaceId,
} from "@osva-ai/contracts";
import { and, eq, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import type { Database } from "../database.js";
import type * as schema from "../schema/index.js";
import { inferenceModelInvocationSlots } from "../schema/inference-model-invocation-slots.js";

type DbTx = PostgresJsDatabase<typeof schema>;

export class PostgresInferenceBudgetOrdinalRepository implements InferenceBudgetInvocationOrdinalPort {
  constructor(private readonly database: Database) {}

  async allocateOrGetOrdinal(
    request: InferenceBudgetAllocateModelInvocationOrdinalRequestV1,
  ): Promise<InferenceBudgetModelInvocationOrdinalV1> {
    const now = new Date();

    return this.database.db.transaction(async (tx) => {
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtext(${request.runAttemptId} || ':' || ${request.bindingName}))`,
      );

      const [existing] = await tx
        .select()
        .from(inferenceModelInvocationSlots)
        .where(
          and(
            eq(inferenceModelInvocationSlots.workspaceId, request.workspaceId),
            eq(
              inferenceModelInvocationSlots.runAttemptId,
              request.runAttemptId,
            ),
            eq(inferenceModelInvocationSlots.bindingName, request.bindingName),
            eq(
              inferenceModelInvocationSlots.logicalOperationKey,
              request.logicalOperationKey,
            ),
          ),
        )
        .limit(1);

      if (existing !== undefined) {
        return {
          modelInvocationOrdinal: existing.modelInvocationOrdinal,
          logicalOperationKey: request.logicalOperationKey,
        };
      }

      const nextOrdinal = await this.resolveNextOrdinal(
        tx,
        request.workspaceId,
        request.runAttemptId,
        request.bindingName,
      );

      await tx
        .insert(inferenceModelInvocationSlots)
        .values({
          id: randomUUID(),
          workspaceId: request.workspaceId,
          runAttemptId: request.runAttemptId,
          bindingName: request.bindingName,
          logicalOperationKey: request.logicalOperationKey,
          modelInvocationOrdinal: nextOrdinal,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoNothing({
          target: [
            inferenceModelInvocationSlots.workspaceId,
            inferenceModelInvocationSlots.runAttemptId,
            inferenceModelInvocationSlots.bindingName,
            inferenceModelInvocationSlots.logicalOperationKey,
          ],
        });

      const [raced] = await tx
        .select()
        .from(inferenceModelInvocationSlots)
        .where(
          and(
            eq(inferenceModelInvocationSlots.workspaceId, request.workspaceId),
            eq(
              inferenceModelInvocationSlots.runAttemptId,
              request.runAttemptId,
            ),
            eq(inferenceModelInvocationSlots.bindingName, request.bindingName),
            eq(
              inferenceModelInvocationSlots.logicalOperationKey,
              request.logicalOperationKey,
            ),
          ),
        )
        .limit(1);

      if (raced === undefined) {
        throw new Error("Inference budget ordinal slot insert failed.");
      }

      return {
        modelInvocationOrdinal: raced.modelInvocationOrdinal,
        logicalOperationKey: request.logicalOperationKey,
      };
    });
  }

  private async resolveNextOrdinal(
    tx: DbTx,
    workspaceId: WorkspaceId,
    runAttemptId: RunAttemptId,
    bindingName: string,
  ): Promise<number> {
    const [row] = await tx
      .select({
        nextOrdinal: sql<number>`coalesce(max(${inferenceModelInvocationSlots.modelInvocationOrdinal}), 0) + 1`,
      })
      .from(inferenceModelInvocationSlots)
      .where(
        and(
          eq(inferenceModelInvocationSlots.workspaceId, workspaceId),
          eq(inferenceModelInvocationSlots.runAttemptId, runAttemptId),
          eq(inferenceModelInvocationSlots.bindingName, bindingName),
        ),
      );
    return row?.nextOrdinal ?? 1;
  }
}
