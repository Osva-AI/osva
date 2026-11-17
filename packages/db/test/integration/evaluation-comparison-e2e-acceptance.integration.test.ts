import type {
  EvaluationComparisonHumanReviewRevisionId,
  UserId,
} from "@osva-ai/contracts";
import {
  AUTHENTICATION_METHODS,
  EVALUATION_COMPARISON_REASON_CODES,
  HUMAN_WORKSPACE_ROLES,
} from "@osva-ai/contracts";
import {
  GetEvaluationComparison,
  GetEvaluationComparisonAssessment,
  GetEvaluationComparisonCalibration,
  ProcessEvaluationComparisonPairwiseTasks,
  ReconcileEvaluationComparison,
  runtimeControlPlaneScope,
  SubmitEvaluationComparisonHumanReview,
  Workspace,
} from "@osva/domain";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createDatabase, type Database } from "../../src/database.js";
import { migrateDatabase } from "../../src/migrate.js";
import {
  readDrizzleJournal,
  verifyMigrationHistory,
} from "../../src/migration-history.js";
import { PostgresEvaluationComparisonHumanReviewRepository } from "../../src/repositories/postgres-evaluation-comparison-human-review-repository.js";
import { PostgresEvaluationComparisonPairwiseTaskRepository } from "../../src/repositories/postgres-evaluation-comparison-pairwise-task-repository.js";
import { PostgresEvaluationComparisonRepository } from "../../src/repositories/postgres-evaluation-comparison-repository.js";
import { PostgresEvaluationSuiteRepository } from "../../src/repositories/postgres-evaluation-suite-repository.js";
import { PostgresModelProfileRepository } from "../../src/repositories/postgres-model-profile-repository.js";
import { PostgresRunRepository } from "../../src/repositories/postgres-run-repository.js";
import { PostgresWorkspaceRepository } from "../../src/repositories/postgres-workspace-repository.js";

import {
  createComparisonRecord,
  createPairwiseInvoker,
  defaultImprovementScores,
  E2E_CASE_A,
  E2E_WORKSPACE,
  promoteFriendlyPolicy,
  regressionScores,
  seedEvaluationGraph,
  seedModelProfile,
} from "./evaluation-comparison-e2e-fixture.js";
import { NOW } from "./fixtures.js";
import {
  resetStage0Tables,
  startPostgresForTests,
  stopPostgresForTests,
  type PostgresTestContext,
} from "./postgres-harness.js";

const REVIEWER = "user-a5-e2e" as UserId;

function comparisonDeps(database: Database, clock: { now: () => Date }) {
  return {
    comparisons: new PostgresEvaluationComparisonRepository(database),
    pairwiseTasks: new PostgresEvaluationComparisonPairwiseTaskRepository(
      database,
    ),
    humanReviews: new PostgresEvaluationComparisonHumanReviewRepository(
      database,
    ),
    evaluationSuites: new PostgresEvaluationSuiteRepository(database),
    runs: new PostgresRunRepository(database),
    clock,
    ids: { createId: () => `id-${Date.now()}` },
  };
}

function humanScope() {
  return {
    principal: {
      authenticationMethod: AUTHENTICATION_METHODS.HUMAN_SESSION,
      userId: REVIEWER,
      sessionId: "sess-a5-e2e",
      workspaceId: E2E_WORKSPACE,
      humanRole: HUMAN_WORKSPACE_ROLES.DEVELOPER,
    },
  };
}

describe("A5.3 evaluation comparison end-to-end acceptance", () => {
  let context: PostgresTestContext;
  let database: Database;
  let clockMs = NOW.getTime();

  beforeAll(async () => {
    context = await startPostgresForTests();
    database = createDatabase({
      connectionString: context.connectionString,
      max: 10,
      connectTimeoutSeconds: 10,
    });
    await migrateDatabase(database);
  }, 180_000);

  afterAll(async () => {
    await database?.close();
    if (context) {
      await stopPostgresForTests(context);
    }
  });

  beforeEach(async () => {
    clockMs = NOW.getTime();
    await resetStage0Tables(database);
    const workspaces = new PostgresWorkspaceRepository(database);
    await workspaces.save(
      Workspace.create({
        id: E2E_WORKSPACE,
        name: "A5 E2E",
        createdAt: NOW,
      }),
    );
    await seedModelProfile(database);
  });

  it("migration history verifies through 0038 human-review supersession constraint", async () => {
    const report = verifyMigrationHistory();
    expect(report.ok).toBe(true);
    const tags = readDrizzleJournal().entries.map((entry) => entry.tag);
    expect(tags).toContain("0037_evaluation_comparison_slice");
    expect(tags).toContain(
      "0038_evaluation_comparison_human_review_supersedes",
    );

    const { sql } = database;
    const comparisonTable = await sql`
      SELECT to_regclass('public.evaluation_comparisons') AS tbl
    `;
    expect(comparisonTable[0]?.tbl).toBe("evaluation_comparisons");

    const supersessionIndex = await sql`
      SELECT indexname
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND tablename = 'evaluation_comparison_human_review_revisions'
        AND indexname = 'evaluation_comparison_human_review_supersedes_unique'
    `;
    expect(supersessionIndex).toHaveLength(1);
  });

  it("scenario A: candidate improvement with pairwise evidence yields advisory PROMOTE", async () => {
    await seedEvaluationGraph(database, defaultImprovementScores());
    const policy = promoteFriendlyPolicy();
    const { comparisonId } = await createComparisonRecord(database, policy, {
      comparisonId: "cmp-scenario-a" as never,
    });

    const deps = comparisonDeps(database, { now: () => new Date(clockMs) });
    const modelProfiles = new PostgresModelProfileRepository(database);
    const processor = new ProcessEvaluationComparisonPairwiseTasks({
      ...deps,
      judgeModel: createPairwiseInvoker("B_BETTER", {
        pricedCostUsdMicros: 250,
      }),
      modelProfiles,
      executionOwner: "a5-acceptance",
    });

    const processed = await processor.execute({ batchLimit: 20 });
    expect(processed).toBeGreaterThan(0);

    const get = new GetEvaluationComparison(deps);
    const assessment = new GetEvaluationComparisonAssessment(deps);
    const scope = runtimeControlPlaneScope(E2E_WORKSPACE);
    const stored = await get.execute(scope, comparisonId);
    const assessBody = await assessment.execute(scope, comparisonId);

    expect(stored.status).toBe("COMPLETED");
    expect(stored.deterministicSummary?.validScoredPairCount).toBe(3);
    expect(stored.deterministicSummary?.meanPairedScoreDelta).toBeGreaterThan(
      0,
    );
    expect(stored.deterministicSummary?.improvedCaseCount).toBe(3);
    expect(stored.pairwiseSummary?.candidateWins).toBeGreaterThan(0);
    expect(stored.pairwiseSummary?.ties ?? 0).toBe(0);
    expect(assessBody.promotion?.recommendation).toBe("PROMOTE");
    expect(assessBody.promotion?.reasonCodes).toContain(
      EVALUATION_COMPARISON_REASON_CODES.NO_BLOCKING_VIOLATION,
    );
    const succeeded =
      await deps.pairwiseTasks.listSucceededPairwiseTasksByComparison(
        comparisonId,
      );
    expect(succeeded.length).toBeGreaterThan(0);
    expect(succeeded.every((task) => task.status === "SUCCEEDED")).toBe(true);
    expect(stored.policySnapshot).toEqual(policy);

    const reconcile = new ReconcileEvaluationComparison(deps);
    await reconcile.execute(comparisonId, E2E_WORKSPACE);
    const second = await assessment.execute(scope, comparisonId);
    expect(second.promotion?.recommendation).toBe("PROMOTE");
    expect(second.regressionAssessment?.assessedAt).toBe(
      assessBody.regressionAssessment?.assessedAt,
    );
  });

  it("scenario B: verified regression produces BLOCK with machine-readable reasons", async () => {
    await seedEvaluationGraph(database, regressionScores());
    const policy = promoteFriendlyPolicy({
      maxMeanPairedScoreRegression: 0.05,
      maxPerCaseScoreRegression: 0.05,
      criticalCaseIds: [E2E_CASE_A],
      maxNewlyFailingCriticalCases: 0,
    });
    const { comparisonId } = await createComparisonRecord(database, policy, {
      comparisonId: "cmp-scenario-b" as never,
      pairwiseEnabled: false,
    });

    const deps = comparisonDeps(database, { now: () => new Date(clockMs) });
    const assessment = new GetEvaluationComparisonAssessment(deps);
    const body = await assessment.execute(
      runtimeControlPlaneScope(E2E_WORKSPACE),
      comparisonId,
    );

    expect(body.promotion?.recommendation).toBe("BLOCK");
    expect(
      body.regressionAssessment?.blockingViolations.length,
    ).toBeGreaterThan(0);
    expect(body.regressionAssessment?.blockingViolations).toEqual(
      expect.arrayContaining([
        EVALUATION_COMPARISON_REASON_CODES.MEAN_REGRESSION_EXCEEDED,
        EVALUATION_COMPARISON_REASON_CODES.CASE_REGRESSION_EXCEEDED,
      ]),
    );
    const stored = await deps.comparisons.findComparisonById(comparisonId);
    expect(stored?.status).toBe("FAILED");
    expect(stored?.deterministicSummary?.meanPairedScoreDelta).toBeLessThan(0);
  });

  it("scenario C: missing or inconclusive evidence yields INDETERMINATE", async () => {
    const scores = defaultImprovementScores();
    const deps = comparisonDeps(database, { now: () => new Date(clockMs) });

    await resetWorkspaceForE2e(database);
    await seedEvaluationGraph(database, scores);
    const incompleteCmp = await createComparisonRecord(
      database,
      promoteFriendlyPolicy(),
      { comparisonId: "cmp-c-incomplete" as never },
    );
    const storedIncomplete = await deps.comparisons.findComparisonById(
      incompleteCmp.comparisonId,
    );
    expect(storedIncomplete?.status).toBe("RUNNING");
    const assessmentIncomplete = await new GetEvaluationComparisonAssessment(
      deps,
    ).execute(
      runtimeControlPlaneScope(E2E_WORKSPACE),
      incompleteCmp.comparisonId,
    );
    expect(assessmentIncomplete.promotion?.recommendation).toBe(
      "INDETERMINATE",
    );

    await resetWorkspaceForE2e(database);
    await seedEvaluationGraph(database, scores);
    const modelProfiles = new PostgresModelProfileRepository(database);
    const costlyPolicy = promoteFriendlyPolicy({
      requireCompleteTotalCost: true,
      maxTotalKnownCostUsdMicros: 1_000_000,
    });
    const costCmp = await createComparisonRecord(database, costlyPolicy, {
      comparisonId: "cmp-c-cost" as never,
    });
    await new ProcessEvaluationComparisonPairwiseTasks({
      ...deps,
      judgeModel: createPairwiseInvoker("B_BETTER", { usageIncomplete: true }),
      modelProfiles,
      executionOwner: "cost",
    }).execute({ batchLimit: 20 });
    const costAssess = await new GetEvaluationComparisonAssessment(
      deps,
    ).execute(runtimeControlPlaneScope(E2E_WORKSPACE), costCmp.comparisonId);
    expect(costAssess.promotion?.recommendation).toBe("INDETERMINATE");
    expect(costAssess.regressionAssessment?.indeterminateReasons).toContain(
      EVALUATION_COMPARISON_REASON_CODES.COST_UNKNOWN,
    );

    await resetWorkspaceForE2e(database);
    await seedEvaluationGraph(database, scores.slice(0, 2));
    const sampleCmp = await createComparisonRecord(
      database,
      promoteFriendlyPolicy({ minValidScoredPairs: 10 }),
      {
        comparisonId: "cmp-c-sample" as never,
        pairwiseEnabled: false,
      },
    );
    const sampleAssess = await new GetEvaluationComparisonAssessment(
      deps,
    ).execute(runtimeControlPlaneScope(E2E_WORKSPACE), sampleCmp.comparisonId);
    expect(sampleAssess.promotion?.recommendation).toBe("INDETERMINATE");
    expect(sampleAssess.regressionAssessment?.indeterminateReasons).toContain(
      EVALUATION_COMPARISON_REASON_CODES.SCORED_PAIRS_INSUFFICIENT,
    );
  });

  it("scenario D: human review supersession updates calibration without mutating pairwise", async () => {
    await seedEvaluationGraph(database, defaultImprovementScores());
    const { comparisonId } = await createComparisonRecord(database, {
      ...promoteFriendlyPolicy(),
      minCandidatePairwiseWinRate: undefined,
    });
    const deps = comparisonDeps(database, { now: () => new Date(clockMs) });
    const modelProfiles = new PostgresModelProfileRepository(database);
    await new ProcessEvaluationComparisonPairwiseTasks({
      ...deps,
      judgeModel: createPairwiseInvoker("B_BETTER"),
      modelProfiles,
      executionOwner: "human",
    }).execute({ batchLimit: 20 });

    const beforePairwise =
      await deps.comparisons.findComparisonById(comparisonId);
    const submit = new SubmitEvaluationComparisonHumanReview(deps);
    const scope = humanScope();

    const first = await submit.execute(scope, comparisonId, {
      reviewerUserId: REVIEWER,
      evaluationCaseId: E2E_CASE_A,
      decision: "BASELINE_BETTER",
      rationale: "Looks wrong to me.",
    });
    const second = await submit.execute(scope, comparisonId, {
      reviewerUserId: REVIEWER,
      evaluationCaseId: E2E_CASE_A,
      decision: "CANDIDATE_BETTER",
      rationale: "On second look, candidate wins.",
      supersedesRevisionId: first.id,
    });

    const effective = await deps.humanReviews.findEffectiveReviewForCase(
      comparisonId,
      E2E_CASE_A,
      REVIEWER,
    );
    expect(effective?.id).toBe(second.id);

    const all = await deps.humanReviews.listReviewsByComparison(comparisonId);
    expect(all.some((r) => r.id === first.id)).toBe(true);
    expect(all.some((r) => r.id === second.id)).toBe(true);

    const calibration = new GetEvaluationComparisonCalibration(deps);
    const cal = await calibration.execute(scope, comparisonId);
    expect(cal.eligiblePairedLabelCount).toBeGreaterThan(0);

    const afterPairwise =
      await deps.comparisons.findComparisonById(comparisonId);
    expect(afterPairwise?.pairwiseSummary).toEqual(
      beforePairwise?.pairwiseSummary,
    );
    void first;
    void second;
  });

  it("scenario E: reconciliation completes after terminal tasks without additional provider calls", async () => {
    await seedEvaluationGraph(database, defaultImprovementScores().slice(0, 1));
    const policy = promoteFriendlyPolicy({ minValidScoredPairs: 1 });
    const { comparisonId } = await createComparisonRecord(database, policy, {
      comparisonId: "cmp-scenario-e" as never,
    });

    const deps = comparisonDeps(database, { now: () => new Date(clockMs) });
    const modelProfiles = new PostgresModelProfileRepository(database);
    let providerCalls = 0;
    const completingProcessor = new ProcessEvaluationComparisonPairwiseTasks({
      ...deps,
      judgeModel: {
        generateJudgeCompletion: async () => {
          providerCalls += 1;
          return {
            text: JSON.stringify({
              preference: "B_BETTER",
              reason: "Candidate is better.",
              evidence: ["E2E"],
            }),
            inputTokens: 40,
            outputTokens: 20,
            configuredProviderModelId: "gpt-4o-mini",
            providerReportedModelId: "gpt-4o-mini",
            pricedCostUsdMicros: 200,
          };
        },
      },
      modelProfiles,
      executionOwner: "worker-complete",
    });
    for (let round = 0; round < 3; round++) {
      await completingProcessor.execute({ batchLimit: 10 });
    }
    expect(providerCalls).toBeGreaterThan(0);

    await database.sql`
      update evaluation_comparisons
      set promotion = null, regression_assessment = null, status = 'RUNNING'
      where id = ${comparisonId}
    `;

    const reconcileOnly = new ProcessEvaluationComparisonPairwiseTasks({
      ...deps,
      judgeModel: {
        generateJudgeCompletion: async () => {
          providerCalls += 1;
          throw new Error(
            "must not invoke provider after terminal persistence",
          );
        },
      },
      modelProfiles,
      executionOwner: "reconcile-only",
    });
    const beforeCalls = providerCalls;
    await reconcileOnly.execute({ batchLimit: 5 });
    expect(providerCalls).toBe(beforeCalls);

    const comparison = await deps.comparisons.findComparisonByWorkspaceAndId(
      E2E_WORKSPACE,
      comparisonId,
    );
    expect(comparison?.status).toBe("COMPLETED");
    expect(comparison?.promotion?.recommendation).toBeDefined();
  });

  it("scenario D concurrent supersession retains a single effective successor", async () => {
    await seedEvaluationGraph(database, defaultImprovementScores().slice(0, 1));
    const { comparisonId } = await createComparisonRecord(
      database,
      promoteFriendlyPolicy({ minValidScoredPairs: 1 }),
      { comparisonId: "cmp-concurrent-hr" as never, pairwiseEnabled: false },
    );
    const reviews = depsFrom(database).humanReviews;
    const baseId = "rev-e2e-base" as EvaluationComparisonHumanReviewRevisionId;
    await reviews.appendReviewRevision({
      id: baseId,
      workspaceId: E2E_WORKSPACE,
      comparisonId,
      evaluationCaseId: E2E_CASE_A,
      reviewerUserId: REVIEWER,
      decision: "TIE",
      evidenceReference: "rubric",
      createdAt: NOW,
    });

    const correctionA = reviews.appendReviewRevision({
      id: "rev-e2e-a" as EvaluationComparisonHumanReviewRevisionId,
      workspaceId: E2E_WORKSPACE,
      comparisonId,
      evaluationCaseId: E2E_CASE_A,
      reviewerUserId: REVIEWER,
      decision: "CANDIDATE_BETTER",
      evidenceReference: "rubric",
      supersedesRevisionId: baseId,
      createdAt: new Date("2026-01-03T00:00:00.000Z"),
    });
    const correctionB = reviews.appendReviewRevision({
      id: "rev-e2e-b" as EvaluationComparisonHumanReviewRevisionId,
      workspaceId: E2E_WORKSPACE,
      comparisonId,
      evaluationCaseId: E2E_CASE_A,
      reviewerUserId: REVIEWER,
      decision: "BASELINE_BETTER",
      evidenceReference: "rubric",
      supersedesRevisionId: baseId,
      createdAt: new Date("2026-01-03T00:00:01.000Z"),
    });
    const results = await Promise.allSettled([correctionA, correctionB]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
  });
});

function depsFrom(database: Database) {
  return comparisonDeps(database, { now: () => NOW });
}

async function resetWorkspaceForE2e(database: Database): Promise<void> {
  await resetStage0Tables(database);
  const workspaces = new PostgresWorkspaceRepository(database);
  await workspaces.save(
    Workspace.create({
      id: E2E_WORKSPACE,
      name: "A5 E2E",
      createdAt: NOW,
    }),
  );
  await seedModelProfile(database);
}
