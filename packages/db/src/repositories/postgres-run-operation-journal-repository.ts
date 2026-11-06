import { randomUUID } from "node:crypto";

import type { RunId } from "@osva-ai/contracts";
import type {
  CommitRunOperationResultCommand,
  MarkRunOperationFailedCommand,
  MarkRunOperationUncertainCommand,
  RecordRunOperationPendingCommand,
  RunOperationJournalRepository,
} from "@osva/domain";
import { and, eq, inArray, or } from "drizzle-orm";

import type { Database } from "../database.js";
import { runOperationJournalFromRow } from "../mappers/run-operation-journal-mapper.js";
import { mapDatabaseError } from "../postgres-errors.js";
import { runOperationJournal } from "../schema/run-operation-journal.js";

export class PostgresRunOperationJournalRepository implements RunOperationJournalRepository {
  constructor(private readonly database: Database) {}

  async recordPending(command: RecordRunOperationPendingCommand) {
    const existing = await this.findByRunAndOperationKey(
      command.workspaceId,
      command.runId,
      command.operationKey,
    );
    if (existing !== null) {
      return existing;
    }

    const now = new Date();
    const id = randomUUID();
    try {
      const [row] = await this.database.db
        .insert(runOperationJournal)
        .values({
          id,
          workspaceId: command.workspaceId,
          runId: command.runId,
          runAttemptId: command.runAttemptId,
          executionGeneration: command.executionGeneration,
          operationKey: command.operationKey,
          toolVersionId: command.toolVersionId,
          bindingName: command.bindingName,
          inputFingerprint: command.inputFingerprint,
          idempotencyClass: command.idempotencyClass,
          status: "PENDING",
          committedResult: null,
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      if (row === undefined) {
        throw new Error("Operation journal insert did not return a row.");
      }
      return runOperationJournalFromRow(row);
    } catch (error) {
      throw mapDatabaseError(error, {
        run_operation_journal_run_operation_key_unique:
          "Operation key already exists for this run.",
      });
    }
  }

  async commitResult(command: CommitRunOperationResultCommand) {
    const [row] = await this.database.db
      .update(runOperationJournal)
      .set({
        status: "COMMITTED",
        committedResult: command.committedResult,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(runOperationJournal.workspaceId, command.workspaceId),
          eq(runOperationJournal.runId, command.runId),
          eq(runOperationJournal.operationKey, command.operationKey),
        ),
      )
      .returning();

    return row === undefined ? null : runOperationJournalFromRow(row);
  }

  async markUncertain(command: MarkRunOperationUncertainCommand) {
    const [row] = await this.database.db
      .update(runOperationJournal)
      .set({
        status: "UNCERTAIN",
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(runOperationJournal.workspaceId, command.workspaceId),
          eq(runOperationJournal.runId, command.runId),
          eq(runOperationJournal.operationKey, command.operationKey),
        ),
      )
      .returning();

    return row === undefined ? null : runOperationJournalFromRow(row);
  }

  async markFailed(command: MarkRunOperationFailedCommand) {
    const [row] = await this.database.db
      .update(runOperationJournal)
      .set({
        status: "FAILED",
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(runOperationJournal.workspaceId, command.workspaceId),
          eq(runOperationJournal.runId, command.runId),
          eq(runOperationJournal.operationKey, command.operationKey),
        ),
      )
      .returning();

    return row === undefined ? null : runOperationJournalFromRow(row);
  }

  async findByRunAndOperationKey(
    workspaceId: RecordRunOperationPendingCommand["workspaceId"],
    runId: RunId,
    operationKey: string,
  ) {
    const [row] = await this.database.db
      .select()
      .from(runOperationJournal)
      .where(
        and(
          eq(runOperationJournal.workspaceId, workspaceId),
          eq(runOperationJournal.runId, runId),
          eq(runOperationJournal.operationKey, operationKey),
        ),
      )
      .limit(1);

    return row === undefined ? null : runOperationJournalFromRow(row);
  }

  async findBlockingOperationsForRun(runId: RunId) {
    const rows = await this.database.db
      .select()
      .from(runOperationJournal)
      .where(
        and(
          eq(runOperationJournal.runId, runId),
          or(
            inArray(runOperationJournal.status, ["PENDING", "UNCERTAIN"]),
            and(
              eq(runOperationJournal.idempotencyClass, "UNKNOWN_WRITE"),
              inArray(runOperationJournal.status, [
                "PENDING",
                "UNCERTAIN",
                "FAILED",
              ]),
            ),
          ),
        ),
      );

    return rows.map(runOperationJournalFromRow);
  }

  async listByRun(runId: RunId) {
    const rows = await this.database.db
      .select()
      .from(runOperationJournal)
      .where(eq(runOperationJournal.runId, runId));

    return rows.map(runOperationJournalFromRow);
  }
}
