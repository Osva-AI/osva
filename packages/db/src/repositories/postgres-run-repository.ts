import type {
  RunAttemptId,
  RunAttemptState,
  RunId,
  RunState,
} from "@osva/contracts";
import {
  DomainInvariantError,
  LifecycleConflictError,
  RunAttemptNotFoundError,
  RunNotFoundError,
  assertLegalRunAttemptTransition,
  assertLegalRunTransition,
} from "@osva/domain";
import type {
  ListRunsQuery,
  ListRunsResult,
  Run,
  RunAttempt,
  RunLifecycleTransitionResult,
  RunRepository,
  RunStep,
} from "@osva/domain";
import { and, asc, desc, eq, lt, or, type SQL } from "drizzle-orm";

import type { Database } from "../database.js";
import {
  runAttemptFromRow,
  runAttemptToRow,
} from "../mappers/run-attempt-mapper.js";
import { runFromRow, runToRow } from "../mappers/run-mapper.js";
import { runStepToRow } from "../mappers/run-step-mapper.js";
import { withMappedDatabaseErrors } from "../postgres-errors.js";
import { runAttempts } from "../schema/run-attempts.js";
import { runSteps } from "../schema/run-steps.js";
import { runs } from "../schema/runs.js";

const RUN_INSERT_MESSAGES = {
  runs_pkey: (run: Run) => `A Run with id '${run.id}' already exists.`,
  runs_workspace_id_idempotency_key_unique: (run: Run) =>
    run.idempotencyKey
      ? `A Run with idempotency key '${run.idempotencyKey}' already exists in workspace '${run.workspaceId}'.`
      : "A Run with this workspace idempotency key already exists.",
  runs_workspace_id_agent_id_agents_fk: (run: Run) =>
    `Agent '${run.agentId}' does not belong to workspace '${run.workspaceId}'.`,
  runs_agent_id_agent_version_id_agent_versions_fk: (run: Run) =>
    `AgentVersion '${run.effectiveBindings.agentVersionId}' does not belong to Agent '${run.agentId}'.`,
};

const RUN_ATTEMPT_INSERT_MESSAGES = {
  run_attempts_pkey: (attempt: RunAttempt) =>
    `A RunAttempt with id '${attempt.id}' already exists.`,
  run_attempts_run_id_id_unique: (attempt: RunAttempt) =>
    `A RunAttempt with id '${attempt.id}' already exists.`,
  run_attempts_run_id_sequence_unique: (attempt: RunAttempt) =>
    `RunAttempt sequence ${String(attempt.sequence)} already exists for Run '${attempt.runId}'.`,
  run_attempts_run_id_runs_id_fk: (attempt: RunAttempt) =>
    `RunAttempt '${attempt.id}' must belong to an existing Run.`,
};

export class PostgresRunRepository implements RunRepository {
  constructor(private readonly database: Database) {}

  async createRunWithInitialAttempt(
    run: Run,
    attempt: RunAttempt,
  ): Promise<void> {
    if (attempt.runId !== run.id) {
      throw new DomainInvariantError(
        "Initial RunAttempt.runId must match the created Run.id.",
      );
    }

    await withMappedDatabaseErrors(
      () =>
        this.database.db.transaction(async (tx) => {
          await tx.insert(runs).values(runToRow(run));
          await tx.insert(runAttempts).values(runAttemptToRow(attempt));
        }),
      {
        ...runInsertMessages(run),
        ...runAttemptInsertMessages(attempt),
      },
    );
  }

  async saveRun(run: Run): Promise<void> {
    await withMappedDatabaseErrors(
      () => this.database.db.insert(runs).values(runToRow(run)),
      runInsertMessages(run),
    );
  }

  async findRunById(id: RunId): Promise<Run | null> {
    const [row] = await this.database.db
      .select()
      .from(runs)
      .where(eq(runs.id, id))
      .limit(1);

    return row === undefined ? null : runFromRow(row);
  }

  async listRuns(query: ListRunsQuery): Promise<ListRunsResult> {
    const conditions: SQL[] = [];

    if (query.agentId !== undefined) {
      conditions.push(eq(runs.agentId, query.agentId));
    }

    if (query.agentVersionId !== undefined) {
      conditions.push(eq(runs.agentVersionId, query.agentVersionId));
    }

    if (query.status !== undefined) {
      conditions.push(eq(runs.status, query.status));
    }

    if (query.cursor !== undefined) {
      const cursorCondition = or(
        lt(runs.createdAt, query.cursor.createdAt),
        and(
          eq(runs.createdAt, query.cursor.createdAt),
          lt(runs.id, query.cursor.id),
        ),
      );
      if (cursorCondition) {
        conditions.push(cursorCondition);
      }
    }

    const rows = await this.database.db
      .select()
      .from(runs)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(runs.createdAt), desc(runs.id))
      .limit(query.limit + 1);

    const hasMore = rows.length > query.limit;
    const page = hasMore ? rows.slice(0, query.limit) : rows;
    const last = page[page.length - 1];

    return {
      runs: page.map(runFromRow),
      nextCursor:
        hasMore && last !== undefined
          ? { createdAt: last.createdAt, id: last.id as RunId }
          : undefined,
    };
  }

  async saveRunAttempt(attempt: RunAttempt): Promise<void> {
    await withMappedDatabaseErrors(
      () =>
        this.database.db.insert(runAttempts).values(runAttemptToRow(attempt)),
      runAttemptInsertMessages(attempt),
    );
  }

  async findRunAttemptById(id: RunAttemptId): Promise<RunAttempt | null> {
    const [row] = await this.database.db
      .select()
      .from(runAttempts)
      .where(eq(runAttempts.id, id))
      .limit(1);

    return row === undefined ? null : runAttemptFromRow(row);
  }

  async listRunAttempts(runId: RunId): Promise<readonly RunAttempt[]> {
    const rows = await this.database.db
      .select()
      .from(runAttempts)
      .where(eq(runAttempts.runId, runId))
      .orderBy(asc(runAttempts.sequence));

    return rows.map(runAttemptFromRow);
  }

  async saveRunStep(step: RunStep): Promise<void> {
    const row = runStepToRow(step);

    await withMappedDatabaseErrors(
      () => this.database.db.insert(runSteps).values(row),
      {
        run_steps_run_attempt_same_run_fk:
          "RunStep must reference a RunAttempt that belongs to the same Run.",
      },
    );
  }

  async transitionRun(expectedStatus: RunState, next: Run): Promise<Run> {
    assertLegalRunTransition(expectedStatus, next.status);

    const [row] = await this.database.db
      .update(runs)
      .set({
        status: next.status,
        updatedAt: next.updatedAt,
      })
      .where(and(eq(runs.id, next.id), eq(runs.status, expectedStatus)))
      .returning();

    if (row !== undefined) {
      return runFromRow(row);
    }

    const existing = await this.findRunById(next.id);
    if (existing === null) {
      throw new RunNotFoundError(next.id);
    }

    throw new LifecycleConflictError("run", next.id, expectedStatus);
  }

  async transitionRunAttempt(
    expectedStatus: RunAttemptState,
    next: RunAttempt,
  ): Promise<RunAttempt> {
    assertLegalRunAttemptTransition(expectedStatus, next.status);

    const [row] = await this.database.db
      .update(runAttempts)
      .set({
        status: next.status,
        startedAt: next.startedAt ?? null,
        completedAt: next.completedAt ?? null,
        error: next.error ?? null,
        output: next.status === "SUCCEEDED" ? (next.output ?? null) : null,
        infrastructureMetadata: next.infrastructureMetadata ?? null,
      })
      .where(
        and(
          eq(runAttempts.id, next.id),
          eq(runAttempts.status, expectedStatus),
        ),
      )
      .returning();

    if (row !== undefined) {
      return runAttemptFromRow(row);
    }

    const existing = await this.findRunAttemptById(next.id);
    if (existing === null) {
      throw new RunAttemptNotFoundError(next.id);
    }

    throw new LifecycleConflictError("runAttempt", next.id, expectedStatus);
  }

  async transitionRunAndAttempt(
    expectedRunStatus: RunState,
    nextRun: Run,
    expectedAttemptStatus: RunAttemptState,
    nextAttempt: RunAttempt,
  ): Promise<RunLifecycleTransitionResult> {
    if (nextAttempt.runId !== nextRun.id) {
      throw new DomainInvariantError(
        "Paired RunAttempt.runId must match the Run.id.",
      );
    }

    assertLegalRunTransition(expectedRunStatus, nextRun.status);
    assertLegalRunAttemptTransition(expectedAttemptStatus, nextAttempt.status);

    return this.database.db.transaction(async (tx) => {
      const [attemptRow] = await tx
        .update(runAttempts)
        .set({
          status: nextAttempt.status,
          startedAt: nextAttempt.startedAt ?? null,
          completedAt: nextAttempt.completedAt ?? null,
          error: nextAttempt.error ?? null,
          output:
            nextAttempt.status === "SUCCEEDED"
              ? (nextAttempt.output ?? null)
              : null,
          infrastructureMetadata: nextAttempt.infrastructureMetadata ?? null,
        })
        .where(
          and(
            eq(runAttempts.id, nextAttempt.id),
            eq(runAttempts.status, expectedAttemptStatus),
          ),
        )
        .returning();

      if (attemptRow === undefined) {
        const [existingAttempt] = await tx
          .select()
          .from(runAttempts)
          .where(eq(runAttempts.id, nextAttempt.id))
          .limit(1);
        if (existingAttempt === undefined) {
          throw new RunAttemptNotFoundError(nextAttempt.id);
        }

        throw new LifecycleConflictError(
          "runAttempt",
          nextAttempt.id,
          expectedAttemptStatus,
        );
      }

      const [runRow] = await tx
        .update(runs)
        .set({
          status: nextRun.status,
          updatedAt: nextRun.updatedAt,
        })
        .where(and(eq(runs.id, nextRun.id), eq(runs.status, expectedRunStatus)))
        .returning();

      if (runRow === undefined) {
        const [existingRun] = await tx
          .select()
          .from(runs)
          .where(eq(runs.id, nextRun.id))
          .limit(1);
        if (existingRun === undefined) {
          throw new RunNotFoundError(nextRun.id);
        }

        throw new LifecycleConflictError("run", nextRun.id, expectedRunStatus);
      }

      return {
        run: runFromRow(runRow),
        runAttempt: runAttemptFromRow(attemptRow),
      };
    });
  }
}

function runInsertMessages(run: Run): Record<string, string> {
  return {
    runs_pkey: RUN_INSERT_MESSAGES.runs_pkey(run),
    runs_workspace_id_idempotency_key_unique:
      RUN_INSERT_MESSAGES.runs_workspace_id_idempotency_key_unique(run),
    runs_workspace_id_agent_id_agents_fk:
      RUN_INSERT_MESSAGES.runs_workspace_id_agent_id_agents_fk(run),
    runs_agent_id_agent_version_id_agent_versions_fk:
      RUN_INSERT_MESSAGES.runs_agent_id_agent_version_id_agent_versions_fk(run),
  };
}

function runAttemptInsertMessages(attempt: RunAttempt): Record<string, string> {
  return {
    run_attempts_pkey: RUN_ATTEMPT_INSERT_MESSAGES.run_attempts_pkey(attempt),
    run_attempts_run_id_id_unique:
      RUN_ATTEMPT_INSERT_MESSAGES.run_attempts_run_id_id_unique(attempt),
    run_attempts_run_id_sequence_unique:
      RUN_ATTEMPT_INSERT_MESSAGES.run_attempts_run_id_sequence_unique(attempt),
    run_attempts_run_id_runs_id_fk:
      RUN_ATTEMPT_INSERT_MESSAGES.run_attempts_run_id_runs_id_fk(attempt),
  };
}
