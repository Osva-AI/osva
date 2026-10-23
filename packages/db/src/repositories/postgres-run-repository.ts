import type {
  RunAttemptId,
  RunAttemptState,
  RunId,
  RunState,
  RunStepId,
  WorkspaceId,
} from "@osva-ai/contracts";
import {
  DomainInvariantError,
  LifecycleConflictError,
  RunAttemptNotFoundError,
  RunNotFoundError,
  RunStepNotFoundError,
  assertLegalRunAttemptTransition,
  assertLegalRunTransition,
  isTerminalRunState,
} from "@osva/domain";
import type {
  FailExpiredLeasedAttemptCommand,
  FinalizeRunStepProps,
  ListRunStepsQuery,
  ListRunStepsResult,
  ListRunsQuery,
  ListRunsResult,
  QueuedPendingDelivery,
  RenewExecutionLeaseCommand,
  Run,
  RunAttempt,
  RunAttemptUsageSummary,
  RunLifecycleTransitionResult,
  RunRepository,
  RunStep,
} from "@osva/domain";
import {
  and,
  asc,
  desc,
  eq,
  gt,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  or,
  sql,
  type SQL,
} from "drizzle-orm";

import type { Database } from "../database.js";
import {
  runAttemptFromRow,
  runAttemptToRow,
} from "../mappers/run-attempt-mapper.js";
import { runFromRow, runToRow } from "../mappers/run-mapper.js";
import { runStepFromRow, runStepToRow } from "../mappers/run-step-mapper.js";
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

  async findRunByWorkspaceAndId(
    workspaceId: WorkspaceId,
    id: RunId,
  ): Promise<Run | null> {
    const [row] = await this.database.db
      .select()
      .from(runs)
      .where(and(eq(runs.id, id), eq(runs.workspaceId, workspaceId)))
      .limit(1);

    return row === undefined ? null : runFromRow(row);
  }

  async findRunByWorkspaceIdempotencyKey(
    workspaceId: WorkspaceId,
    idempotencyKey: string,
  ): Promise<Run | null> {
    const [row] = await this.database.db
      .select()
      .from(runs)
      .where(
        and(
          eq(runs.workspaceId, workspaceId),
          eq(runs.idempotencyKey, idempotencyKey),
        ),
      )
      .limit(1);

    return row === undefined ? null : runFromRow(row);
  }

  async listRuns(query: ListRunsQuery): Promise<ListRunsResult> {
    const conditions: SQL[] = [eq(runs.workspaceId, query.workspaceId)];

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
      .where(and(...conditions))
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

  async findCapabilityEligibleRunAttemptById(
    id: RunAttemptId,
  ): Promise<RunAttempt | null> {
    const [row] = await this.database.db
      .select()
      .from(runAttempts)
      .where(
        and(
          eq(runAttempts.id, id),
          eq(runAttempts.status, "RUNNING"),
          or(
            isNull(runAttempts.executionOwner),
            and(
              isNotNull(runAttempts.executionOwner),
              gt(runAttempts.leaseExpiresAt, sql`now()`),
            ),
          ),
        ),
      )
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

  async listRunAttemptsForRuns(
    runIds: readonly RunId[],
  ): Promise<readonly RunAttempt[]> {
    if (runIds.length === 0) {
      return [];
    }

    const rows = await this.database.db
      .select()
      .from(runAttempts)
      .where(inArray(runAttempts.runId, [...runIds]))
      .orderBy(asc(runAttempts.runId), asc(runAttempts.sequence));

    return rows.map(runAttemptFromRow);
  }

  async insertRunningRunStep(step: RunStep): Promise<void> {
    if (step.status !== "RUNNING") {
      throw new DomainInvariantError(
        "insertRunningRunStep requires a RUNNING RunStep.",
      );
    }

    const row = runStepToRow(step);

    await withMappedDatabaseErrors(
      () => this.database.db.insert(runSteps).values(row),
      {
        run_steps_run_attempt_same_run_fk:
          "RunStep must reference a RunAttempt that belongs to the same Run.",
        run_steps_pkey: `A RunStep with id '${step.id}' already exists.`,
      },
    );
  }

  async finalizeRunStep(
    runStepId: RunStepId,
    finalize: FinalizeRunStepProps,
  ): Promise<RunStep> {
    const existing = await this.findRunStepById(runStepId);
    if (existing === null) {
      throw new RunStepNotFoundError(runStepId);
    }

    const finalized = existing.finalize(finalize);
    const row = runStepToRow(finalized);

    const [updated] = await this.database.db
      .update(runSteps)
      .set({
        status: row.status,
        completedAt: row.completedAt,
        inputTokens: row.inputTokens,
        outputTokens: row.outputTokens,
        totalTokens: row.totalTokens,
        cachedInputTokens: row.cachedInputTokens,
        estimatedCostUsdMicros: row.estimatedCostUsdMicros,
        errorCode: row.errorCode,
      })
      .where(and(eq(runSteps.id, runStepId), eq(runSteps.status, "RUNNING")))
      .returning();

    if (updated !== undefined) {
      return runStepFromRow(updated);
    }

    const current = await this.findRunStepById(runStepId);
    if (current === null) {
      throw new RunStepNotFoundError(runStepId);
    }

    throw new LifecycleConflictError("runStep", runStepId, "RUNNING");
  }

  async findRunStepById(id: RunStepId): Promise<RunStep | null> {
    const [row] = await this.database.db
      .select()
      .from(runSteps)
      .where(eq(runSteps.id, id))
      .limit(1);

    return row === undefined ? null : runStepFromRow(row);
  }

  async listRunSteps(query: ListRunStepsQuery): Promise<ListRunStepsResult> {
    const conditions: SQL[] = [eq(runSteps.runAttemptId, query.runAttemptId)];

    if (query.cursor !== undefined) {
      const cursorCondition = or(
        gt(runSteps.startedAt, query.cursor.startedAt),
        and(
          eq(runSteps.startedAt, query.cursor.startedAt),
          gt(runSteps.id, query.cursor.id),
        ),
      );
      if (cursorCondition) {
        conditions.push(cursorCondition);
      }
    }

    const rows = await this.database.db
      .select()
      .from(runSteps)
      .where(and(...conditions))
      .orderBy(asc(runSteps.startedAt), asc(runSteps.id))
      .limit(query.limit + 1);

    const hasMore = rows.length > query.limit;
    const page = hasMore ? rows.slice(0, query.limit) : rows;
    const last = page[page.length - 1];

    return {
      steps: page.map(runStepFromRow),
      nextCursor:
        hasMore && last !== undefined
          ? {
              startedAt: last.startedAt,
              id: last.id as RunStepId,
            }
          : undefined,
    };
  }

  async aggregateRunAttemptUsage(
    runAttemptId: RunAttemptId,
  ): Promise<RunAttemptUsageSummary> {
    return this.aggregateRunAttemptUsageBatch([runAttemptId]);
  }

  async aggregateRunAttemptUsageBatch(
    runAttemptIds: readonly RunAttemptId[],
  ): Promise<RunAttemptUsageSummary> {
    if (runAttemptIds.length === 0) {
      return {
        modelCalls: 0,
        toolCalls: 0,
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        cachedInputTokens: 0,
        estimatedCostUsdMicros: null,
        pricedModelCalls: 0,
        unpricedModelCalls: 0,
      };
    }

    const measurableModel = measurableModelRunStepSql();

    const [row] = await this.database.db
      .select({
        modelCalls: sql<number>`count(*) filter (where ${measurableModel})`,
        toolCalls: sql<number>`count(*) filter (where ${runSteps.kind} = 'TOOL' and ${runSteps.status} = 'SUCCEEDED')`,
        inputTokens: sql<number>`coalesce(sum(${runSteps.inputTokens}) filter (where ${measurableModel}), 0)`,
        outputTokens: sql<number>`coalesce(sum(${runSteps.outputTokens}) filter (where ${measurableModel}), 0)`,
        totalTokens: sql<number>`coalesce(sum(${runSteps.totalTokens}) filter (where ${measurableModel}), 0)`,
        cachedInputTokens: sql<number>`coalesce(sum(${runSteps.cachedInputTokens}) filter (where ${measurableModel}), 0)`,
        estimatedCostUsdMicros: sql<
          number | null
        >`sum(${runSteps.estimatedCostUsdMicros}) filter (where ${measurableModel} and ${runSteps.estimatedCostUsdMicros} is not null)`,
        pricedModelCalls: sql<number>`count(*) filter (where ${measurableModel} and ${runSteps.estimatedCostUsdMicros} is not null)`,
        unpricedModelCalls: sql<number>`count(*) filter (where ${measurableModel} and ${runSteps.estimatedCostUsdMicros} is null)`,
      })
      .from(runSteps)
      .where(inArray(runSteps.runAttemptId, [...runAttemptIds]));

    return runAttemptUsageSummaryFromRow(row);
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
      .set(runAttemptUpdateSet(next))
      .where(runAttemptTransitionWhere(next, expectedStatus))
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
    options?: { readonly leaseTtlMs?: number },
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
        .set(runAttemptUpdateSet(nextAttempt, options?.leaseTtlMs))
        .where(runAttemptTransitionWhere(nextAttempt, expectedAttemptStatus))
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

  async renewExecutionLease(
    command: RenewExecutionLeaseCommand,
  ): Promise<boolean> {
    const [row] = await this.database.db
      .update(runAttempts)
      .set({
        leaseExpiresAt: sql`now() + (${command.ttlMs}::int * interval '1 millisecond')`,
      })
      .where(
        and(
          eq(runAttempts.id, command.runAttemptId),
          eq(runAttempts.status, "RUNNING"),
          eq(runAttempts.executionOwner, command.owner),
          eq(runAttempts.executionGeneration, command.generation),
          gt(runAttempts.leaseExpiresAt, sql`now()`),
        ),
      )
      .returning({ id: runAttempts.id });

    return row !== undefined;
  }

  async failExpiredLeasedAttempt(
    command: FailExpiredLeasedAttemptCommand,
  ): Promise<RunLifecycleTransitionResult | null> {
    return this.database.db.transaction(async (tx) => {
      const [attemptRow] = await tx
        .update(runAttempts)
        .set({
          status: "FAILED",
          completedAt: sql`now()`,
          error: command.error,
          output: null,
          leaseExpiresAt: null,
          infrastructureMetadata: command.infrastructureMetadata ?? null,
        })
        .where(
          and(
            eq(runAttempts.id, command.runAttemptId),
            eq(runAttempts.status, "RUNNING"),
            eq(runAttempts.executionGeneration, command.generation),
            isNotNull(runAttempts.executionOwner),
            lte(runAttempts.leaseExpiresAt, sql`now()`),
          ),
        )
        .returning();

      if (attemptRow === undefined) {
        return null;
      }

      const [runRow] = await tx
        .update(runs)
        .set({
          status: "FAILED",
          updatedAt: sql`now()`,
        })
        .where(and(eq(runs.id, attemptRow.runId), eq(runs.status, "RUNNING")))
        .returning();

      if (runRow === undefined) {
        const [existingRun] = await tx
          .select()
          .from(runs)
          .where(eq(runs.id, attemptRow.runId))
          .limit(1);
        if (
          existingRun !== undefined &&
          isTerminalRunState(existingRun.status as RunState)
        ) {
          return {
            run: runFromRow(existingRun),
            runAttempt: runAttemptFromRow(attemptRow),
          };
        }

        throw new LifecycleConflictError(
          "run",
          attemptRow.runId as RunId,
          "RUNNING",
        );
      }

      return {
        run: runFromRow(runRow),
        runAttempt: runAttemptFromRow(attemptRow),
      };
    });
  }

  async listExpiredLeasedRunningAttempts(
    limit: number,
  ): Promise<readonly RunAttempt[]> {
    const rows = await this.database.db
      .select()
      .from(runAttempts)
      .where(
        and(
          eq(runAttempts.status, "RUNNING"),
          isNotNull(runAttempts.executionOwner),
          lte(runAttempts.leaseExpiresAt, sql`now()`),
        ),
      )
      .orderBy(asc(runAttempts.leaseExpiresAt), asc(runAttempts.id))
      .limit(limit);

    return rows.map(runAttemptFromRow);
  }

  async listQueuedPendingDeliveries(
    limit: number,
  ): Promise<readonly QueuedPendingDelivery[]> {
    const rows = await this.database.db
      .select({
        run: runs,
        attempt: runAttempts,
      })
      .from(runs)
      .innerJoin(runAttempts, eq(runAttempts.runId, runs.id))
      .where(and(eq(runs.status, "QUEUED"), eq(runAttempts.status, "PENDING")))
      .orderBy(asc(runs.createdAt), asc(runs.id))
      .limit(limit);

    return rows.map((row) => ({
      run: runFromRow(row.run),
      runAttempt: runAttemptFromRow(row.attempt),
    }));
  }
}

function runAttemptUpdateSet(
  next: RunAttempt,
  leaseTtlMs?: number,
): Record<string, unknown> {
  const leaseExpiresAt =
    next.status === "RUNNING" && leaseTtlMs !== undefined
      ? sql`now() + (${leaseTtlMs}::int * interval '1 millisecond')`
      : (next.leaseExpiresAt ?? null);

  return {
    status: next.status,
    startedAt: next.startedAt ?? null,
    completedAt: next.completedAt ?? null,
    error: next.error ?? null,
    output: next.status === "SUCCEEDED" ? (next.output ?? null) : null,
    infrastructureMetadata: next.infrastructureMetadata ?? null,
    executionOwner: next.executionOwner ?? null,
    executionGeneration: next.executionGeneration,
    leaseExpiresAt,
  };
}

function runAttemptTransitionWhere(
  next: RunAttempt,
  expectedStatus: RunAttemptState,
): SQL {
  if (
    expectedStatus === "RUNNING" &&
    next.executionOwner !== undefined &&
    next.status !== "RUNNING"
  ) {
    const fenced = and(
      eq(runAttempts.id, next.id),
      eq(runAttempts.status, expectedStatus),
      eq(runAttempts.executionOwner, next.executionOwner),
      eq(runAttempts.executionGeneration, next.executionGeneration),
      gt(runAttempts.leaseExpiresAt, sql`now()`),
    );
    if (fenced === undefined) {
      throw new DomainInvariantError("Lease fence predicate is required.");
    }
    return fenced;
  }

  const unfenced = and(
    eq(runAttempts.id, next.id),
    eq(runAttempts.status, expectedStatus),
  );
  if (unfenced === undefined) {
    throw new DomainInvariantError("Attempt transition predicate is required.");
  }
  return unfenced;
}

function measurableModelRunStepSql(): SQL {
  return sql`(
    ${runSteps.kind} = 'MODEL'
    AND (
      ${runSteps.status} = 'SUCCEEDED'
      OR (
        ${runSteps.status} = 'FAILED'
        AND (
          coalesce(${runSteps.inputTokens}, 0) > 0
          OR coalesce(${runSteps.outputTokens}, 0) > 0
          OR ${runSteps.estimatedCostUsdMicros} IS NOT NULL
        )
      )
    )
  )`;
}

function runAttemptUsageSummaryFromRow(
  row:
    | {
        readonly modelCalls: number;
        readonly toolCalls: number;
        readonly inputTokens: number;
        readonly outputTokens: number;
        readonly totalTokens: number;
        readonly cachedInputTokens: number;
        readonly estimatedCostUsdMicros: number | null;
        readonly pricedModelCalls: number;
        readonly unpricedModelCalls: number;
      }
    | undefined,
): RunAttemptUsageSummary {
  return {
    modelCalls: Number(row?.modelCalls ?? 0),
    toolCalls: Number(row?.toolCalls ?? 0),
    inputTokens: Number(row?.inputTokens ?? 0),
    outputTokens: Number(row?.outputTokens ?? 0),
    totalTokens: Number(row?.totalTokens ?? 0),
    cachedInputTokens: Number(row?.cachedInputTokens ?? 0),
    estimatedCostUsdMicros:
      row?.estimatedCostUsdMicros === null ||
      row?.estimatedCostUsdMicros === undefined
        ? null
        : Number(row.estimatedCostUsdMicros),
    pricedModelCalls: Number(row?.pricedModelCalls ?? 0),
    unpricedModelCalls: Number(row?.unpricedModelCalls ?? 0),
  };
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
