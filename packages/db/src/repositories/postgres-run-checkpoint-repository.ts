import { randomUUID } from "node:crypto";

import type {
  CommitRunCheckpointCommand,
  CommitRunCheckpointResult,
  RunCheckpointRecordV1,
  RunId,
  WorkspaceId,
} from "@osva-ai/contracts";
import {
  RUN_CHECKPOINT_ENVELOPE_VERSION,
  RUN_CHECKPOINT_MAX_HISTORY_PER_RUN,
  RUN_CHECKPOINT_MAX_STATE_BYTES,
} from "@osva-ai/contracts";
import {
  digestCheckpointPayload,
  digestRunCheckpointBindings,
  validateDeclarativeCheckpointState,
  type ListRunCheckpointsQuery,
  type ListRunCheckpointsResult,
  type RunCheckpointRepository,
} from "@osva/domain";
import { and, desc, eq, sql } from "drizzle-orm";

import type { Database } from "../database.js";
import { runCheckpointFromRow } from "../mappers/run-checkpoint-mapper.js";
import { mapDatabaseError } from "../postgres-errors.js";
import { runAttempts } from "../schema/run-attempts.js";
import { runCheckpoints } from "../schema/run-checkpoints.js";

export class PostgresRunCheckpointRepository implements RunCheckpointRepository {
  constructor(private readonly database: Database) {}

  async commit(
    command: CommitRunCheckpointCommand,
  ): Promise<CommitRunCheckpointResult> {
    if (!validateDeclarativeCheckpointState(command.state)) {
      return { outcome: "invalid_state" };
    }

    const serialized = JSON.stringify(command.state);
    if (
      Buffer.byteLength(serialized, "utf8") > RUN_CHECKPOINT_MAX_STATE_BYTES
    ) {
      return { outcome: "payload_too_large" };
    }

    const existing = await this.findByIdempotencyKey(
      command.workspaceId,
      command.runId,
      command.idempotencyKey,
    );
    if (existing !== null) {
      return { outcome: "duplicate", checkpoint: existing };
    }

    const bindingDigest = digestRunCheckpointBindings(command.bindingIdentity);
    const payloadDigest = digestCheckpointPayload(command.state);

    return this.database.db.transaction(async (tx) => {
      const [attemptRow] = await tx
        .select({
          id: runAttempts.id,
          executionGeneration: runAttempts.executionGeneration,
          executionOwner: runAttempts.executionOwner,
          status: runAttempts.status,
        })
        .from(runAttempts)
        .where(
          and(
            eq(runAttempts.id, command.runAttemptId),
            eq(runAttempts.runId, command.runId),
          ),
        )
        .limit(1);

      if (attemptRow === undefined || attemptRow.status !== "RUNNING") {
        return { outcome: "stale_generation" as const };
      }

      if (
        attemptRow.executionGeneration !== command.executionGeneration ||
        attemptRow.executionOwner !== command.executionOwner
      ) {
        return { outcome: "stale_generation" as const };
      }

      const [seqRow] = await tx
        .select({
          nextSequence: sql<number>`coalesce(max(${runCheckpoints.sequence}), 0) + 1`,
        })
        .from(runCheckpoints)
        .where(eq(runCheckpoints.runId, command.runId));

      const sequence = Number(seqRow?.nextSequence ?? 1);
      const id = randomUUID();
      const createdAt = new Date();

      try {
        const [inserted] = await tx
          .insert(runCheckpoints)
          .values({
            id,
            workspaceId: command.workspaceId,
            runId: command.runId,
            sequence,
            runAttemptId: command.runAttemptId,
            executionGeneration: command.executionGeneration,
            runtimeKind: command.runtimeKind,
            envelopeVersion: RUN_CHECKPOINT_ENVELOPE_VERSION,
            stateSchemaVersion: command.state.schemaVersion,
            agentVersionId: command.bindingIdentity.agentVersionId,
            bindingIdentity: command.bindingIdentity,
            bindingDigest,
            cursor: {
              ...command.cursor,
              checkpointSequence: sequence,
            },
            state: command.state,
            payloadDigest,
            idempotencyKey: command.idempotencyKey,
            createdAt,
          })
          .returning();

        if (inserted === undefined) {
          throw new Error("Checkpoint insert did not return a row.");
        }

        const countRows = await tx
          .select({ count: sql<number>`count(*)::int` })
          .from(runCheckpoints)
          .where(eq(runCheckpoints.runId, command.runId));
        const count = Number(countRows[0]?.count ?? 0);
        if (count > RUN_CHECKPOINT_MAX_HISTORY_PER_RUN) {
          await tx.execute(sql`
            DELETE FROM run_checkpoints
            WHERE id IN (
              SELECT id FROM run_checkpoints
              WHERE run_id = ${command.runId}
              ORDER BY sequence ASC
              LIMIT ${count - RUN_CHECKPOINT_MAX_HISTORY_PER_RUN}
            )
          `);
        }

        return {
          outcome: "committed" as const,
          checkpoint: runCheckpointFromRow(inserted),
        };
      } catch (error) {
        const mapped = mapDatabaseError(error, {
          run_checkpoints_run_id_idempotency_key_unique:
            "Checkpoint idempotency key already exists for this run.",
          run_checkpoints_run_id_sequence_unique:
            "Checkpoint sequence already exists for this run.",
        }) as Error;
        if (
          mapped.message.includes("idempotency") ||
          mapped.message.includes("sequence")
        ) {
          const duplicate = await this.findByIdempotencyKey(
            command.workspaceId,
            command.runId,
            command.idempotencyKey,
          );
          if (duplicate !== null) {
            return { outcome: "duplicate", checkpoint: duplicate };
          }
        }
        throw mapped;
      }
    });
  }

  async findLatestByRun(
    workspaceId: WorkspaceId,
    runId: RunId,
  ): Promise<RunCheckpointRecordV1 | null> {
    const [row] = await this.database.db
      .select()
      .from(runCheckpoints)
      .where(
        and(
          eq(runCheckpoints.workspaceId, workspaceId),
          eq(runCheckpoints.runId, runId),
        ),
      )
      .orderBy(desc(runCheckpoints.sequence))
      .limit(1);

    return row === undefined ? null : runCheckpointFromRow(row);
  }

  async findByRunAndSequence(
    workspaceId: WorkspaceId,
    runId: RunId,
    sequence: number,
  ): Promise<RunCheckpointRecordV1 | null> {
    const [row] = await this.database.db
      .select()
      .from(runCheckpoints)
      .where(
        and(
          eq(runCheckpoints.workspaceId, workspaceId),
          eq(runCheckpoints.runId, runId),
          eq(runCheckpoints.sequence, sequence),
        ),
      )
      .limit(1);

    return row === undefined ? null : runCheckpointFromRow(row);
  }

  async list(
    query: ListRunCheckpointsQuery,
  ): Promise<ListRunCheckpointsResult> {
    const rows = await this.database.db
      .select()
      .from(runCheckpoints)
      .where(
        and(
          eq(runCheckpoints.workspaceId, query.workspaceId),
          eq(runCheckpoints.runId, query.runId),
        ),
      )
      .orderBy(desc(runCheckpoints.sequence))
      .limit(query.limit);

    return {
      checkpoints: rows.map((row) => runCheckpointFromRow(row)),
    };
  }

  async findByIdempotencyKey(
    workspaceId: WorkspaceId,
    runId: RunId,
    idempotencyKey: string,
  ): Promise<RunCheckpointRecordV1 | null> {
    const [row] = await this.database.db
      .select()
      .from(runCheckpoints)
      .where(
        and(
          eq(runCheckpoints.workspaceId, workspaceId),
          eq(runCheckpoints.runId, runId),
          eq(runCheckpoints.idempotencyKey, idempotencyKey),
        ),
      )
      .limit(1);

    return row === undefined ? null : runCheckpointFromRow(row);
  }

  async countByRun(runId: RunId): Promise<number> {
    const [row] = await this.database.db
      .select({ count: sql<number>`count(*)::int` })
      .from(runCheckpoints)
      .where(eq(runCheckpoints.runId, runId));
    return Number(row?.count ?? 0);
  }

  async deleteOldestBeyondLimit(runId: RunId, keep: number): Promise<void> {
    await this.database.db.execute(sql`
      DELETE FROM run_checkpoints
      WHERE id IN (
        SELECT id FROM run_checkpoints
        WHERE run_id = ${runId}
        ORDER BY sequence DESC
        OFFSET ${keep}
      )
    `);
  }
}
