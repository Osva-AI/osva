import type {
  EvaluationCaseId,
  EvaluationJudgeTaskId,
  EvaluationRunId,
  EvaluationSuiteVersionId,
  WorkspaceId,
} from "@osva-ai/contracts";
import { EvaluationJudgeTask, Workspace } from "@osva/domain";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createDatabase, type Database } from "../../src/database.js";
import { migrateDatabase } from "../../src/migrate.js";
import { PostgresEvaluationJudgeTaskRepository } from "../../src/repositories/postgres-evaluation-judge-task-repository.js";
import { PostgresWorkspaceRepository } from "../../src/repositories/postgres-workspace-repository.js";
import { evaluationJudgeTasks } from "../../src/schema/evaluation-judge-tasks.js";
import { NOW } from "./fixtures.js";
import {
  resetStage0Tables,
  startPostgresForTests,
  stopPostgresForTests,
  type PostgresTestContext,
} from "./postgres-harness.js";

describe("PostgreSQL evaluation judge tasks", () => {
  let context: PostgresTestContext;
  let database: Database;
  let judgeTasks: PostgresEvaluationJudgeTaskRepository;

  beforeAll(async () => {
    context = await startPostgresForTests();
    database = createDatabase({
      connectionString: context.connectionString,
      max: 10,
      connectTimeoutSeconds: 10,
    });
    await migrateDatabase(database);
    judgeTasks = new PostgresEvaluationJudgeTaskRepository(database);
  });

  afterAll(async () => {
    await database?.close();
    if (context) {
      await stopPostgresForTests(context);
    }
  });

  beforeEach(async () => {
    await resetStage0Tables(database);
    const workspaces = new PostgresWorkspaceRepository(database);
    await workspaces.save(
      Workspace.create({
        id: "workspace_judge" as WorkspaceId,
        name: "Judge Workspace",
        createdAt: NOW,
      }),
    );
  });

  function pendingTask(
    id: string,
    overrides?: {
      readonly workspaceId?: WorkspaceId;
      readonly evaluationCaseId?: EvaluationCaseId;
    },
  ): EvaluationJudgeTask {
    return EvaluationJudgeTask.create({
      id: id as EvaluationJudgeTaskId,
      workspaceId: (overrides?.workspaceId ?? "workspace_judge") as WorkspaceId,
      evaluationRunId: "evaluation-run-judge" as EvaluationRunId,
      evaluationCaseId: (overrides?.evaluationCaseId ??
        "evaluation-case-judge") as EvaluationCaseId,
      runId: "run-judge" as never,
      runAttemptId: "run-attempt-judge" as never,
      snapshot: {
        evaluatorConfig: {
          type: "LLM_JUDGE",
          rubric: "Score quality.",
          modelProfileVersionId: "mpv-judge",
        },
        rubricIdentity: "rubric-sha",
        minPassingScore: 0.7,
        maxOutputTokens: 512,
        evaluationSuiteVersionId: "esv-judge" as EvaluationSuiteVersionId,
        caseInput: { prompt: "x" },
      },
      createdAt: NOW,
      maxAttempts: 3,
    });
  }

  async function insertEvaluationRunGraph(): Promise<void> {
    const { sql } = database;
    await sql`
      insert into evaluation_suites (id, workspace_id, key, name, created_at, updated_at)
      values ('es-judge', 'workspace_judge', 'suite', 'Suite', ${NOW.toISOString()}, ${NOW.toISOString()})
    `;
    await sql`
      insert into evaluation_suite_versions (id, evaluation_suite_id, workspace_id, version, created_at)
      values ('esv-judge', 'es-judge', 'workspace_judge', 1, ${NOW.toISOString()})
    `;
    await sql`
      insert into evaluation_cases (id, evaluation_suite_version_id, key, input, evaluator, created_at)
      values
      (
        'evaluation-case-judge',
        'esv-judge',
        'only',
        '{"prompt":"x"}'::jsonb,
        '{"type":"LLM_JUDGE","rubric":"Score quality.","modelProfileVersionId":"mpv-judge"}'::jsonb,
        ${NOW.toISOString()}
      ),
      (
        'evaluation-case-conflict',
        'esv-judge',
        'conflict',
        '{"prompt":"y"}'::jsonb,
        '{"type":"LLM_JUDGE","rubric":"Score quality.","modelProfileVersionId":"mpv-judge"}'::jsonb,
        ${NOW.toISOString()}
      )
    `;
    await sql`
      insert into evaluation_runs (
        id, workspace_id, evaluation_suite_version_id, target_type, target_version_id, status, created_at, updated_at
      )
      values (
        'evaluation-run-judge',
        'workspace_judge',
        'esv-judge',
        'AGENT_VERSION',
        'av-judge',
        'RUNNING',
        ${NOW.toISOString()},
        ${NOW.toISOString()}
      )
    `;
    await sql`
      insert into agents (id, workspace_id, key, name, created_at)
      values ('agent-judge', 'workspace_judge', 'a', 'Agent', ${NOW.toISOString()})
    `;
    await sql`
      insert into agent_versions (id, agent_id, version, manifest, created_at)
      values (
        'av-judge',
        'agent-judge',
        1,
        '{"schemaVersion":"1","key":"a","name":"A","runtime":{"type":"BUILTIN_PACKAGE","key":"a"},"input":{"schema":{}},"output":{"schema":{}},"execution":{"timeoutMs":1000,"maxAttempts":1},"capabilities":{"model":false,"tools":[]}}'::jsonb,
        ${NOW.toISOString()}
      )
    `;
    await sql`
      insert into runs (
        id, workspace_id, agent_id, status, agent_version_id,
        model_profile_version_bindings, tool_version_bindings, memory_namespace_bindings, knowledge_index_bindings,
        input, created_at, updated_at
      )
      values (
        'run-judge',
        'workspace_judge',
        'agent-judge',
        'SUCCEEDED',
        'av-judge',
        '{}'::jsonb,
        '{}'::jsonb,
        '{}'::jsonb,
        '{}'::jsonb,
        '{"prompt":"x"}'::jsonb,
        ${NOW.toISOString()},
        ${NOW.toISOString()}
      )
    `;
    await sql`
      insert into run_attempts (id, run_id, sequence, status, output, created_at)
      values (
        'run-attempt-judge',
        'run-judge',
        1,
        'SUCCEEDED',
        '"answer"'::jsonb,
        ${NOW.toISOString()}
      )
    `;
  }

  it("allows exactly one concurrent claim on a PENDING task", async () => {
    await insertEvaluationRunGraph();
    const task = pendingTask("judge-task-1");
    await judgeTasks.saveJudgeTaskIfAbsent(task);

    const later = new Date(NOW.getTime() + 120_000);
    const [first, second] = await Promise.all([
      judgeTasks.claimJudgeTaskLease({
        taskId: task.id,
        workspaceId: task.workspaceId,
        owner: "worker-a",
        generation: 1,
        leaseExpiresAt: later,
        now: NOW,
      }),
      judgeTasks.claimJudgeTaskLease({
        taskId: task.id,
        workspaceId: task.workspaceId,
        owner: "worker-b",
        generation: 1,
        leaseExpiresAt: later,
        now: NOW,
      }),
    ]);

    const winners = [first, second].filter((value) => value !== null);
    expect(winners).toHaveLength(1);
    expect(winners[0]?.executionOwner).toBeDefined();
    expect(winners[0]?.status).toBe("RUNNING");
    expect(winners[0]?.executionGeneration).toBe(1);
    expect(winners[0]?.attemptCount).toBe(1);
  });

  it("reclaims only expired RUNNING leases and rejects active leases", async () => {
    await insertEvaluationRunGraph();
    const task = pendingTask("judge-task-lease");
    await judgeTasks.saveJudgeTaskIfAbsent(task);

    const activeLease = new Date(NOW.getTime() + 60_000);
    const claimed = await judgeTasks.claimJudgeTaskLease({
      taskId: task.id,
      workspaceId: task.workspaceId,
      owner: "worker-active",
      generation: 1,
      leaseExpiresAt: activeLease,
      now: NOW,
    });
    expect(claimed).not.toBeNull();

    const steal = await judgeTasks.claimJudgeTaskLease({
      taskId: task.id,
      workspaceId: task.workspaceId,
      owner: "worker-thief",
      generation: 2,
      leaseExpiresAt: new Date(NOW.getTime() + 120_000),
      now: NOW,
    });
    expect(steal).toBeNull();

    await database.db
      .update(evaluationJudgeTasks)
      .set({ leaseExpiresAt: new Date(NOW.getTime() - 1_000) })
      .where(eq(evaluationJudgeTasks.id, task.id));

    const reclaimed = await judgeTasks.claimJudgeTaskLease({
      taskId: task.id,
      workspaceId: task.workspaceId,
      owner: "worker-reclaim",
      generation: 2,
      leaseExpiresAt: new Date(NOW.getTime() + 120_000),
      now: NOW,
    });
    expect(reclaimed?.executionOwner).toBe("worker-reclaim");
    expect(reclaimed?.executionGeneration).toBe(2);
    expect(reclaimed?.attemptCount).toBe(2);
  });

  it("fences stale workers from persisting terminal updates", async () => {
    await insertEvaluationRunGraph();
    const task = pendingTask("judge-task-fence");
    await judgeTasks.saveJudgeTaskIfAbsent(task);

    const stale = await judgeTasks.claimJudgeTaskLease({
      taskId: task.id,
      workspaceId: task.workspaceId,
      owner: "worker-stale",
      generation: 1,
      leaseExpiresAt: new Date(NOW.getTime() - 1),
      now: NOW,
    });
    if (stale === null) {
      throw new Error("expected stale claim");
    }

    const fresh = await judgeTasks.claimJudgeTaskLease({
      taskId: task.id,
      workspaceId: task.workspaceId,
      owner: "worker-fresh",
      generation: 2,
      leaseExpiresAt: new Date(NOW.getTime() + 120_000),
      now: NOW,
    });
    expect(fresh?.executionGeneration).toBe(2);

    const staleSucceeded = stale.withSucceeded({
      updatedAt: NOW,
      terminalResult: { verdict: { score: 1 } },
    });
    expect(await judgeTasks.saveJudgeTaskTerminal(staleSucceeded)).toBe(false);

    const freshSucceeded = fresh!.withSucceeded({
      updatedAt: NOW,
      terminalResult: { verdict: { score: 0.8 } },
    });
    expect(await judgeTasks.saveJudgeTaskTerminal(freshSucceeded)).toBe(true);

    const stored = await judgeTasks.findJudgeTaskById(task.id);
    expect(stored?.status).toBe("SUCCEEDED");
    expect(stored?.executionGeneration).toBe(2);
  });

  it("does not reclaim terminal tasks and enforces workspace identity", async () => {
    await insertEvaluationRunGraph();
    const task = pendingTask("judge-task-terminal");
    await judgeTasks.saveJudgeTaskIfAbsent(task);
    const claimed = await judgeTasks.claimJudgeTaskLease({
      taskId: task.id,
      workspaceId: task.workspaceId,
      owner: "worker-1",
      generation: 1,
      leaseExpiresAt: new Date(NOW.getTime() + 60_000),
      now: NOW,
    });
    const succeeded = claimed!.withSucceeded({
      updatedAt: NOW,
      terminalResult: {},
    });
    await judgeTasks.saveJudgeTaskTerminal(succeeded);

    const recovery = await judgeTasks.listJudgeTasksForRecovery(10, NOW);
    expect(recovery.map((row) => row.id)).not.toContain(task.id);

    const wrongWorkspace = await judgeTasks.claimJudgeTaskLease({
      taskId: task.id,
      workspaceId: "workspace_other" as WorkspaceId,
      owner: "worker-x",
      generation: 2,
      leaseExpiresAt: new Date(NOW.getTime() + 60_000),
      now: NOW,
    });
    expect(wrongWorkspace).toBeNull();
  });

  it("rejects conflicting terminal updates and idempotently accepts duplicate terminal writes", async () => {
    await insertEvaluationRunGraph();
    const task = pendingTask("judge-task-idempotent");
    await judgeTasks.saveJudgeTaskIfAbsent(task);
    const claimed = await judgeTasks.claimJudgeTaskLease({
      taskId: task.id,
      workspaceId: task.workspaceId,
      owner: "worker-idem",
      generation: 1,
      leaseExpiresAt: new Date(NOW.getTime() + 60_000),
      now: NOW,
    });
    const succeeded = claimed!.withSucceeded({
      updatedAt: NOW,
      terminalResult: { verdict: { score: 0.9 } },
    });
    expect(await judgeTasks.saveJudgeTaskTerminal(succeeded)).toBe(true);
    expect(await judgeTasks.saveJudgeTaskTerminal(succeeded)).toBe(false);

    const otherTask = pendingTask("judge-task-conflict", {
      evaluationCaseId: "evaluation-case-conflict" as EvaluationCaseId,
    });
    await judgeTasks.saveJudgeTaskIfAbsent(otherTask);
    const claimedOther = await judgeTasks.claimJudgeTaskLease({
      taskId: otherTask.id,
      workspaceId: otherTask.workspaceId,
      owner: "worker-conflict",
      generation: 1,
      leaseExpiresAt: new Date(NOW.getTime() + 60_000),
      now: NOW,
    });
    const failed = claimedOther!.withFailed({
      errorCode: "judge_error",
      updatedAt: NOW,
    });
    expect(await judgeTasks.saveJudgeTaskTerminal(failed)).toBe(true);
    const conflicting = failed.withSucceeded({
      updatedAt: NOW,
      terminalResult: { verdict: { score: 0.1 } },
    });
    expect(await judgeTasks.saveJudgeTaskTerminal(conflicting)).toBe(false);
  });

  it("exposes migration 0036 judge task schema objects", async () => {
    const columns = await database.sql<{ column_name: string }[]>`
      select column_name
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'evaluation_judge_tasks'
      order by column_name
    `;
    const names = new Set(columns.map((row) => row.column_name));
    for (const expected of [
      "attempt_count",
      "evaluation_case_id",
      "evaluation_run_id",
      "execution_generation",
      "execution_owner",
      "lease_expires_at",
      "max_attempts",
      "snapshot",
      "status",
      "terminal_result",
      "workspace_id",
    ]) {
      expect(names.has(expected)).toBe(true);
    }

    const uniques = await database.sql<{ conname: string }[]>`
      select conname
      from pg_constraint
      where conrelid = 'evaluation_judge_tasks'::regclass
        and contype = 'u'
    `;
    expect(uniques.some((row) => row.conname.includes("run_case"))).toBe(true);

    const indexes = await database.sql<{ indexname: string }[]>`
      select indexname
      from pg_indexes
      where schemaname = 'public'
        and tablename = 'evaluation_judge_tasks'
    `;
    expect(indexes.some((row) => row.indexname.includes("recovery"))).toBe(
      true,
    );
  });
});
