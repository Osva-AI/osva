import type {
  EvaluationCaseId,
  EvaluationComparisonId,
  EvaluationComparisonPairwiseTaskId,
  EvaluationRunId,
  EvaluationSuiteVersionId,
  ModelProfileVersionId,
  WorkspaceId,
} from "@osva-ai/contracts";
import {
  EvaluationComparison,
  EvaluationComparisonPairwiseTask,
  Workspace,
} from "@osva/domain";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createDatabase, type Database } from "../../src/database.js";
import { migrateDatabase } from "../../src/migrate.js";
import { PostgresEvaluationComparisonPairwiseTaskRepository } from "../../src/repositories/postgres-evaluation-comparison-pairwise-task-repository.js";
import { PostgresEvaluationComparisonRepository } from "../../src/repositories/postgres-evaluation-comparison-repository.js";
import { PostgresWorkspaceRepository } from "../../src/repositories/postgres-workspace-repository.js";
import { evaluationComparisonPairwiseTasks } from "../../src/schema/evaluation-comparisons.js";
import {
  EVALUATION_COMPARISON_PAIRWISE_CONFIG_SCHEMA_VERSION,
  EVALUATION_COMPARISON_POLICY_SCHEMA_VERSION,
  type EvaluationComparisonPolicyV1,
} from "@osva-ai/contracts";
import { NOW } from "./fixtures.js";
import {
  resetStage0Tables,
  startPostgresForTests,
  stopPostgresForTests,
  type PostgresTestContext,
} from "./postgres-harness.js";

const MPV_PW = "mpv-pw" as ModelProfileVersionId;

const SAMPLE_POLICY: EvaluationComparisonPolicyV1 = {
  schemaVersion: EVALUATION_COMPARISON_POLICY_SCHEMA_VERSION,
  minComparisonCoverage: 0,
  minValidScoredPairs: 0,
  maxMeanPairedScoreRegression: 1,
  maxPerCaseScoreRegression: 1,
  maxNewlyFailingCriticalCases: 999,
  maxNewEvaluatorErrors: 999,
};

describe("PostgreSQL evaluation comparison pairwise tasks", () => {
  let context: PostgresTestContext;
  let database: Database;
  let pairwiseTasks: PostgresEvaluationComparisonPairwiseTaskRepository;
  let comparisons: PostgresEvaluationComparisonRepository;

  beforeAll(async () => {
    context = await startPostgresForTests();
    database = createDatabase({
      connectionString: context.connectionString,
      max: 10,
      connectTimeoutSeconds: 10,
    });
    await migrateDatabase(database);
    pairwiseTasks = new PostgresEvaluationComparisonPairwiseTaskRepository(
      database,
    );
    comparisons = new PostgresEvaluationComparisonRepository(database);
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
        id: "workspace_pairwise" as WorkspaceId,
        name: "Pairwise Workspace",
        createdAt: NOW,
      }),
    );
  });

  async function insertComparisonGraph(): Promise<{
    comparisonId: EvaluationComparisonId;
    caseId: EvaluationCaseId;
  }> {
    const { sql } = database;
    await sql`
      insert into evaluation_suites (id, workspace_id, key, name, created_at, updated_at)
      values ('es-pw', 'workspace_pairwise', 'suite', 'Suite', ${NOW.toISOString()}, ${NOW.toISOString()})
    `;
    await sql`
      insert into evaluation_suite_versions (id, evaluation_suite_id, workspace_id, version, created_at)
      values ('esv-pw', 'es-pw', 'workspace_pairwise', 1, ${NOW.toISOString()})
    `;
    await sql`
      insert into evaluation_cases (id, evaluation_suite_version_id, key, input, evaluator, created_at)
      values (
        'case-pw',
        'esv-pw',
        'only',
        '{"prompt":"x"}'::jsonb,
        '{"type":"EXACT_MATCH","expected":"x"}'::jsonb,
        ${NOW.toISOString()}
      )
    `;
    await sql`
      insert into agents (id, workspace_id, key, name, created_at)
      values ('agent-pw', 'workspace_pairwise', 'a', 'Agent', ${NOW.toISOString()})
    `;
    await sql`
      insert into agent_versions (id, agent_id, version, manifest, created_at)
      values (
        'av-pw',
        'agent-pw',
        1,
        '{"schemaVersion":"1","key":"a","name":"A","runtime":{"type":"BUILTIN_PACKAGE","key":"a"},"input":{"schema":{}},"output":{"schema":{}},"execution":{"timeoutMs":1000,"maxAttempts":1},"capabilities":{"model":false,"tools":[]}}'::jsonb,
        ${NOW.toISOString()}
      )
    `;
    await sql`
      insert into evaluation_runs (
        id, workspace_id, evaluation_suite_version_id, target_type, target_version_id, status, created_at, updated_at
      )
      values
      (
        'erun-baseline',
        'workspace_pairwise',
        'esv-pw',
        'AGENT_VERSION',
        'av-pw',
        'COMPLETED',
        ${NOW.toISOString()},
        ${NOW.toISOString()}
      ),
      (
        'erun-candidate',
        'workspace_pairwise',
        'esv-pw',
        'AGENT_VERSION',
        'av-pw',
        'COMPLETED',
        ${NOW.toISOString()},
        ${NOW.toISOString()}
      )
    `;

    const comparison = EvaluationComparison.create({
      id: "comparison-pw" as EvaluationComparisonId,
      workspaceId: "workspace_pairwise" as WorkspaceId,
      baselineEvaluationRunId: "erun-baseline" as EvaluationRunId,
      candidateEvaluationRunId: "erun-candidate" as EvaluationRunId,
      evaluationSuiteVersionId: "esv-pw" as EvaluationSuiteVersionId,
      policySnapshot: SAMPLE_POLICY,
      pairwiseConfig: {
        schemaVersion: EVALUATION_COMPARISON_PAIRWISE_CONFIG_SCHEMA_VERSION,
        enabled: true,
        rubric: "Pick better answer.",
        modelProfileVersionId: MPV_PW,
      },
      pairwiseRubricIdentity: "rubric-pw",
      createdAt: NOW,
    });
    await comparisons.saveComparisonIfAbsent(comparison);

    return {
      comparisonId: comparison.id,
      caseId: "case-pw" as EvaluationCaseId,
    };
  }

  function pendingPairwiseTask(
    id: string,
    comparisonId: EvaluationComparisonId,
    caseId: EvaluationCaseId,
  ): EvaluationComparisonPairwiseTask {
    return EvaluationComparisonPairwiseTask.create({
      id: id as EvaluationComparisonPairwiseTaskId,
      workspaceId: "workspace_pairwise" as WorkspaceId,
      comparisonId,
      evaluationCaseId: caseId,
      judgmentPosition: "PRIMARY",
      snapshot: {
        rubricIdentity: "rubric-pw",
        modelProfileVersionId: MPV_PW,
        maxOutputTokens: 512,
        caseInput: { prompt: "x" },
        baselineAnswer: "a",
        candidateAnswer: "b",
        rubric: "Pick better answer.",
        judgmentPosition: "PRIMARY",
      },
      createdAt: NOW,
      maxAttempts: 3,
    });
  }

  it("creates comparison idempotently by run pair", async () => {
    const graph = await insertComparisonGraph();
    const again = EvaluationComparison.create({
      id: "comparison-pw-2" as EvaluationComparisonId,
      workspaceId: "workspace_pairwise" as WorkspaceId,
      baselineEvaluationRunId: "erun-baseline" as EvaluationRunId,
      candidateEvaluationRunId: "erun-candidate" as EvaluationRunId,
      evaluationSuiteVersionId: "esv-pw" as EvaluationSuiteVersionId,
      policySnapshot: SAMPLE_POLICY,
      createdAt: NOW,
    });
    const outcome = await comparisons.saveComparisonIfAbsent(again);
    expect(outcome).toBe("existing");
    const stored = await comparisons.findByRunPair(
      "erun-baseline" as EvaluationRunId,
      "erun-candidate" as EvaluationRunId,
    );
    expect(stored?.id).toBe(graph.comparisonId);
  });

  it("allows exactly one concurrent claim on a PENDING pairwise task", async () => {
    const graph = await insertComparisonGraph();
    const task = pendingPairwiseTask(
      "pairwise-task-1",
      graph.comparisonId,
      graph.caseId,
    );
    await pairwiseTasks.savePairwiseTaskIfAbsent(task);

    const later = new Date(NOW.getTime() + 120_000);
    const [first, second] = await Promise.all([
      pairwiseTasks.claimPairwiseTaskLease({
        taskId: task.id,
        workspaceId: task.workspaceId,
        owner: "worker-a",
        generation: 1,
        leaseExpiresAt: later,
        now: NOW,
      }),
      pairwiseTasks.claimPairwiseTaskLease({
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
    expect(winners[0]?.status).toBe("RUNNING");
    expect(winners[0]?.executionGeneration).toBe(1);
  });

  it("fences stale workers from persisting terminal updates", async () => {
    const graph = await insertComparisonGraph();
    const task = pendingPairwiseTask(
      "pairwise-task-fence",
      graph.comparisonId,
      graph.caseId,
    );
    await pairwiseTasks.savePairwiseTaskIfAbsent(task);

    const stale = await pairwiseTasks.claimPairwiseTaskLease({
      taskId: task.id,
      workspaceId: task.workspaceId,
      owner: "worker-stale",
      generation: 1,
      leaseExpiresAt: new Date(NOW.getTime() - 1),
      now: NOW,
    });
    expect(stale).not.toBeNull();

    const fresh = await pairwiseTasks.claimPairwiseTaskLease({
      taskId: task.id,
      workspaceId: task.workspaceId,
      owner: "worker-fresh",
      generation: 2,
      leaseExpiresAt: new Date(NOW.getTime() + 120_000),
      now: NOW,
    });
    expect(fresh?.executionGeneration).toBe(2);

    const staleSucceeded = stale!.withSucceeded({
      updatedAt: NOW,
      terminalResult: {
        verdict: { canonicalPreference: "BASELINE_BETTER" },
      },
    });
    expect(await pairwiseTasks.savePairwiseTaskTerminal(staleSucceeded)).toBe(
      false,
    );

    const freshSucceeded = fresh!.withSucceeded({
      updatedAt: NOW,
      terminalResult: {
        verdict: { canonicalPreference: "CANDIDATE_BETTER" },
      },
    });
    expect(await pairwiseTasks.savePairwiseTaskTerminal(freshSucceeded)).toBe(
      true,
    );

    const stored = await pairwiseTasks.findPairwiseTaskById(task.id);
    expect(stored?.status).toBe("SUCCEEDED");
    expect(stored?.terminalResult?.verdict?.canonicalPreference).toBe(
      "CANDIDATE_BETTER",
    );
  });

  it("rejects cross-workspace claim", async () => {
    const graph = await insertComparisonGraph();
    const task = pendingPairwiseTask(
      "pairwise-task-ws",
      graph.comparisonId,
      graph.caseId,
    );
    await pairwiseTasks.savePairwiseTaskIfAbsent(task);

    const claimed = await pairwiseTasks.claimPairwiseTaskLease({
      taskId: task.id,
      workspaceId: "workspace_other" as WorkspaceId,
      owner: "worker-x",
      generation: 1,
      leaseExpiresAt: new Date(NOW.getTime() + 60_000),
      now: NOW,
    });
    expect(claimed).toBeNull();
  });

  it("appends invocation attempts without duplicate rows on replay", async () => {
    const graph = await insertComparisonGraph();
    const task = pendingPairwiseTask(
      "pairwise-task-billing",
      graph.comparisonId,
      graph.caseId,
    );
    await pairwiseTasks.savePairwiseTaskIfAbsent(task);
    const claimed = await pairwiseTasks.claimPairwiseTaskLease({
      taskId: task.id,
      workspaceId: task.workspaceId,
      owner: "worker-1",
      generation: 1,
      leaseExpiresAt: new Date(NOW.getTime() + 60_000),
      now: NOW,
    });
    expect(claimed).not.toBeNull();
    const attempt = {
      attemptNumber: 1,
      outcome: "completed",
      inputTokens: 10,
      outputTokens: 5,
      pricedCostUsdMicros: 100,
    };
    expect(
      await pairwiseTasks.appendPairwiseInvocationAttempt({
        taskId: task.id,
        workspaceId: task.workspaceId,
        executionGeneration: 1,
        attempt,
      }),
    ).toBe(true);
    expect(
      await pairwiseTasks.appendPairwiseInvocationAttempt({
        taskId: task.id,
        workspaceId: task.workspaceId,
        executionGeneration: 1,
        attempt,
      }),
    ).toBe(true);

    const stored = await pairwiseTasks.findPairwiseTaskById(task.id);
    const attempts = stored?.terminalResult?.invocationAttempts ?? [];
    expect(attempts).toHaveLength(2);

    const [row] = await database.db
      .select()
      .from(evaluationComparisonPairwiseTasks)
      .where(eq(evaluationComparisonPairwiseTasks.id, task.id))
      .limit(1);
    expect(row?.status).toBe("RUNNING");
  });
});
