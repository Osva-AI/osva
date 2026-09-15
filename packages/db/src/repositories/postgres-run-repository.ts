import type { RunAttemptId, RunId } from "@osva/contracts";
import type { Run, RunAttempt, RunRepository, RunStep } from "@osva/domain";
import { asc, eq } from "drizzle-orm";

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

export class PostgresRunRepository implements RunRepository {
  constructor(private readonly database: Database) {}

  async saveRun(run: Run): Promise<void> {
    const row = runToRow(run);

    await withMappedDatabaseErrors(
      () =>
        this.database.db
          .insert(runs)
          .values(row)
          .onConflictDoUpdate({
            target: runs.id,
            set: {
              workspaceId: row.workspaceId,
              agentId: row.agentId,
              status: row.status,
              agentVersionId: row.agentVersionId,
              modelProfileVersionBindings: row.modelProfileVersionBindings,
              idempotencyKey: row.idempotencyKey,
              createdAt: row.createdAt,
              updatedAt: row.updatedAt,
            },
          }),
      {
        runs_workspace_id_idempotency_key_unique: run.idempotencyKey
          ? `A Run with idempotency key '${run.idempotencyKey}' already exists in workspace '${run.workspaceId}'.`
          : "A Run with this workspace idempotency key already exists.",
        runs_workspace_id_agent_id_agents_fk: `Agent '${run.agentId}' does not belong to workspace '${run.workspaceId}'.`,
        runs_agent_id_agent_version_id_agent_versions_fk: `AgentVersion '${run.effectiveBindings.agentVersionId}' does not belong to Agent '${run.agentId}'.`,
      },
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

  async saveRunAttempt(attempt: RunAttempt): Promise<void> {
    const row = runAttemptToRow(attempt);

    await withMappedDatabaseErrors(
      () =>
        this.database.db
          .insert(runAttempts)
          .values(row)
          .onConflictDoUpdate({
            target: runAttempts.id,
            set: {
              runId: row.runId,
              sequence: row.sequence,
              status: row.status,
              createdAt: row.createdAt,
              startedAt: row.startedAt,
              completedAt: row.completedAt,
              error: row.error,
              infrastructureMetadata: row.infrastructureMetadata,
            },
          }),
      {
        run_attempts_run_id_sequence_unique: `RunAttempt sequence ${String(attempt.sequence)} already exists for Run '${attempt.runId}'.`,
        run_attempts_run_id_runs_id_fk: `RunAttempt '${attempt.id}' must belong to an existing Run.`,
      },
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
      () =>
        this.database.db
          .insert(runSteps)
          .values(row)
          .onConflictDoUpdate({
            target: runSteps.id,
            set: {
              runId: row.runId,
              runAttemptId: row.runAttemptId,
              type: row.type,
              name: row.name,
              startedAt: row.startedAt,
              completedAt: row.completedAt,
              metadata: row.metadata,
            },
          }),
      {
        run_steps_run_attempt_same_run_fk:
          "RunStep must reference a RunAttempt that belongs to the same Run.",
      },
    );
  }
}
