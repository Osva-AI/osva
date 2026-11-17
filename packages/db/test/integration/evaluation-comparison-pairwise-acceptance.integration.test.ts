import type {
  EvaluationCaseId,
  EvaluationComparisonId,
  EvaluationRunId,
  ModelProfileVersionId,
  WorkspaceId,
} from "@osva-ai/contracts";
import {
  EVALUATION_COMPARISON_PAIRWISE_CONFIG_SCHEMA_VERSION,
  EVALUATION_COMPARISON_POLICY_SCHEMA_VERSION,
  type EvaluationComparisonPolicyV1,
} from "@osva-ai/contracts";
import {
  CreateEvaluationComparison,
  ModelProfile,
  ModelProfileVersion,
  ProcessEvaluationComparisonPairwiseTasks,
  Workspace,
  runtimeControlPlaneScope,
} from "@osva/domain";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createDatabase, type Database } from "../../src/database.js";
import { migrateDatabase } from "../../src/migrate.js";
import { PostgresEvaluationComparisonHumanReviewRepository } from "../../src/repositories/postgres-evaluation-comparison-human-review-repository.js";
import { PostgresEvaluationComparisonPairwiseTaskRepository } from "../../src/repositories/postgres-evaluation-comparison-pairwise-task-repository.js";
import { PostgresEvaluationComparisonRepository } from "../../src/repositories/postgres-evaluation-comparison-repository.js";
import { PostgresEvaluationSuiteRepository } from "../../src/repositories/postgres-evaluation-suite-repository.js";
import { PostgresModelProfileRepository } from "../../src/repositories/postgres-model-profile-repository.js";
import { PostgresRunRepository } from "../../src/repositories/postgres-run-repository.js";
import { PostgresWorkspaceRepository } from "../../src/repositories/postgres-workspace-repository.js";
import type { EvaluationJudgeModelInvoker } from "@osva/domain";
import { NOW } from "./fixtures.js";
import {
  resetStage0Tables,
  startPostgresForTests,
  stopPostgresForTests,
  type PostgresTestContext,
} from "./postgres-harness.js";

const POLICY: EvaluationComparisonPolicyV1 = {
  schemaVersion: EVALUATION_COMPARISON_POLICY_SCHEMA_VERSION,
  minComparisonCoverage: 0,
  minValidScoredPairs: 0,
  maxMeanPairedScoreRegression: 1,
  maxPerCaseScoreRegression: 1,
  maxNewlyFailingCriticalCases: 999,
  maxNewEvaluatorErrors: 999,
};

function createPairwiseInvoker(
  preference: "A_BETTER" | "B_BETTER" | "TIE",
): EvaluationJudgeModelInvoker {
  return {
    generateJudgeCompletion: async () => ({
      text: JSON.stringify({
        preference,
        reason: "Structured test verdict.",
        evidence: ["Test evidence."],
      }),
      inputTokens: 80,
      outputTokens: 30,
      configuredProviderModelId: "gpt-4o-mini",
      providerReportedModelId: "gpt-4o-mini",
    }),
  };
}

describe("evaluation comparison pairwise acceptance", () => {
  let context: PostgresTestContext;
  let database: Database;
  const workspaceId = "ws-pairwise-acc" as WorkspaceId;
  const mpvId = "mpv-pairwise-acc" as ModelProfileVersionId;

  beforeAll(async () => {
    context = await startPostgresForTests();
    database = createDatabase({
      connectionString: context.connectionString,
      max: 10,
      connectTimeoutSeconds: 10,
    });
    await migrateDatabase(database);
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
    const modelProfiles = new PostgresModelProfileRepository(database);
    await workspaces.save(
      Workspace.create({
        id: workspaceId,
        name: "Pairwise Acceptance",
        createdAt: NOW,
      }),
    );
    const profile = ModelProfile.create({
      id: "mp-pairwise-acc" as never,
      workspaceId,
      key: "judge",
      name: "Judge",
      createdAt: NOW,
    });
    await modelProfiles.saveModelProfile(profile);
    await modelProfiles.saveModelProfileVersion(
      ModelProfileVersion.create({
        id: mpvId,
        modelProfileId: profile.id,
        version: 1,
        provider: "OPENAI",
        model: "gpt-4o-mini",
        createdAt: NOW,
      }),
    );
  });

  async function seedComparisonFixture(options?: {
    readonly mitigatePositionBias?: boolean;
  }): Promise<{
    comparisonId: EvaluationComparisonId;
    caseId: EvaluationCaseId;
  }> {
    const { sql } = database;
    await sql`
      insert into evaluation_suites (id, workspace_id, key, name, created_at, updated_at)
      values ('es-acc', ${workspaceId}, 'suite', 'Suite', ${NOW.toISOString()}, ${NOW.toISOString()})
    `;
    await sql`
      insert into evaluation_suite_versions (id, evaluation_suite_id, workspace_id, version, created_at)
      values ('esv-acc', 'es-acc', ${workspaceId}, 1, ${NOW.toISOString()})
    `;
    await sql`
      insert into evaluation_cases (id, evaluation_suite_version_id, key, input, evaluator, created_at)
      values (
        'case-acc',
        'esv-acc',
        'only',
        '{"prompt":"2+2?"}'::jsonb,
        '{"type":"EXACT_MATCH","expected":"4"}'::jsonb,
        ${NOW.toISOString()}
      )
    `;
    await sql`
      insert into agents (id, workspace_id, key, name, created_at)
      values ('agent-acc', ${workspaceId}, 'a', 'Agent', ${NOW.toISOString()})
    `;
    await sql`
      insert into agent_versions (id, agent_id, version, manifest, created_at)
      values (
        'av-acc',
        'agent-acc',
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
        'erun-base',
        ${workspaceId},
        'esv-acc',
        'AGENT_VERSION',
        'av-acc',
        'COMPLETED',
        ${NOW.toISOString()},
        ${NOW.toISOString()}
      ),
      (
        'erun-cand',
        ${workspaceId},
        'esv-acc',
        'AGENT_VERSION',
        'av-acc',
        'COMPLETED',
        ${NOW.toISOString()},
        ${NOW.toISOString()}
      )
    `;
    await sql`
      insert into runs (
        id, workspace_id, agent_id, status, agent_version_id, evaluation_run_id, evaluation_case_id,
        model_profile_version_bindings, tool_version_bindings, memory_namespace_bindings, knowledge_index_bindings,
        input, created_at, updated_at
      )
      values
      (
        'run-base',
        ${workspaceId},
        'agent-acc',
        'SUCCEEDED',
        'av-acc',
        'erun-base',
        'case-acc',
        '{}'::jsonb,
        '{}'::jsonb,
        '{}'::jsonb,
        '{}'::jsonb,
        '{"prompt":"2+2?"}'::jsonb,
        ${NOW.toISOString()},
        ${NOW.toISOString()}
      ),
      (
        'run-cand',
        ${workspaceId},
        'agent-acc',
        'SUCCEEDED',
        'av-acc',
        'erun-cand',
        'case-acc',
        '{}'::jsonb,
        '{}'::jsonb,
        '{}'::jsonb,
        '{}'::jsonb,
        '{"prompt":"2+2?"}'::jsonb,
        ${NOW.toISOString()},
        ${NOW.toISOString()}
      )
    `;
    await sql`
      insert into run_attempts (id, run_id, sequence, status, output, created_at)
      values
      (
        'ra-base',
        'run-base',
        1,
        'SUCCEEDED',
        '"three"'::jsonb,
        ${NOW.toISOString()}
      ),
      (
        'ra-cand',
        'run-cand',
        1,
        'SUCCEEDED',
        '"four"'::jsonb,
        ${NOW.toISOString()}
      )
    `;

    const comparisons = new PostgresEvaluationComparisonRepository(database);
    const pairwiseTasks =
      new PostgresEvaluationComparisonPairwiseTaskRepository(database);
    const humanReviews = new PostgresEvaluationComparisonHumanReviewRepository(
      database,
    );
    const evaluationSuites = new PostgresEvaluationSuiteRepository(database);
    const runs = new PostgresRunRepository(database);
    const clock = { now: () => NOW };
    const createComparison = new CreateEvaluationComparison({
      comparisons,
      pairwiseTasks,
      humanReviews,
      evaluationSuites,
      runs,
      clock,
      ids: { createId: () => `cmp-${Date.now()}` },
    });

    const comparison = await createComparison.execute(
      runtimeControlPlaneScope(workspaceId),
      {
        baselineEvaluationRunId: "erun-base" as EvaluationRunId,
        candidateEvaluationRunId: "erun-cand" as EvaluationRunId,
        policy: POLICY,
        pairwise: {
          schemaVersion: EVALUATION_COMPARISON_PAIRWISE_CONFIG_SCHEMA_VERSION,
          enabled: true,
          rubric: "Pick the more accurate answer.",
          modelProfileVersionId: mpvId,
          ...(options?.mitigatePositionBias === true
            ? { mitigatePositionBias: true }
            : {}),
        },
      },
    );

    return {
      comparisonId: comparison.id,
      caseId: "case-acc" as EvaluationCaseId,
    };
  }

  it("executes PRIMARY pairwise task, reconciles promotion, and replays safely", async () => {
    const fixture = await seedComparisonFixture();
    const comparisons = new PostgresEvaluationComparisonRepository(database);
    const pairwiseTasks =
      new PostgresEvaluationComparisonPairwiseTaskRepository(database);
    const humanReviews = new PostgresEvaluationComparisonHumanReviewRepository(
      database,
    );
    const evaluationSuites = new PostgresEvaluationSuiteRepository(database);
    const runs = new PostgresRunRepository(database);
    const modelProfiles = new PostgresModelProfileRepository(database);
    const clock = { now: () => NOW };

    const deps = {
      comparisons,
      pairwiseTasks,
      humanReviews,
      evaluationSuites,
      runs,
      clock,
      ids: { createId: () => `id-${Date.now()}` },
    };

    const processor = new ProcessEvaluationComparisonPairwiseTasks({
      ...deps,
      judgeModel: createPairwiseInvoker("B_BETTER"),
      modelProfiles,
      executionOwner: "test-pairwise",
    });

    const firstPass = await processor.execute({ batchLimit: 10 });
    expect(firstPass).toBeGreaterThan(0);

    const stored = await comparisons.findComparisonByWorkspaceAndId(
      workspaceId,
      fixture.comparisonId,
    );
    expect(stored?.status).toBe("COMPLETED");
    expect(stored?.pairwiseSummary?.caseResults[0]?.canonicalPreference).toBe(
      "CANDIDATE_BETTER",
    );

    const tasks = await pairwiseTasks.listSucceededPairwiseTasksByComparison(
      fixture.comparisonId,
    );
    expect(tasks).toHaveLength(1);
    const attempts = tasks[0]?.terminalResult?.invocationAttempts ?? [];
    expect(attempts).toHaveLength(1);

    const secondPass = await processor.execute({ batchLimit: 10 });
    expect(secondPass).toBe(0);
    const tasksAfter =
      await pairwiseTasks.listSucceededPairwiseTasksByComparison(
        fixture.comparisonId,
      );
    const attemptsAfter =
      tasksAfter[0]?.terminalResult?.invocationAttempts ?? [];
    expect(attemptsAfter).toHaveLength(1);
  });

  it("maps REVERSED A_BETTER to candidate preference", async () => {
    const fixture = await seedComparisonFixture({ mitigatePositionBias: true });
    const comparisons = new PostgresEvaluationComparisonRepository(database);
    const pairwiseTasks =
      new PostgresEvaluationComparisonPairwiseTaskRepository(database);
    const humanReviews = new PostgresEvaluationComparisonHumanReviewRepository(
      database,
    );
    const evaluationSuites = new PostgresEvaluationSuiteRepository(database);
    const runs = new PostgresRunRepository(database);
    const modelProfiles = new PostgresModelProfileRepository(database);

    const processor = new ProcessEvaluationComparisonPairwiseTasks({
      comparisons,
      pairwiseTasks,
      humanReviews,
      evaluationSuites,
      runs,
      clock: { now: () => NOW },
      ids: { createId: () => "x" },
      judgeModel: createPairwiseInvoker("A_BETTER"),
      modelProfiles,
      executionOwner: "test-reversed",
    });

    await processor.execute({ batchLimit: 10 });
    const stored = await comparisons.findComparisonById(fixture.comparisonId);
    const caseResult = stored?.pairwiseSummary?.caseResults.find(
      (row) => row.evaluationCaseId === fixture.caseId,
    );
    expect(caseResult?.reversedPreference).toBe("CANDIDATE_BETTER");
  });
});
