import type {
  EvaluationCaseId,
  EvaluationComparisonHumanReviewRevisionId,
  EvaluationComparisonId,
  UserId,
  WorkspaceId,
} from "@osva-ai/contracts";
import {
  AUTHENTICATION_METHODS,
  HUMAN_WORKSPACE_ROLES,
} from "@osva-ai/contracts";
import {
  computeHumanJudgeCalibration,
  consensusHumanDecisionByCase,
  EvaluationComparison,
  filterNonSupersededHumanReviews,
  SubmitEvaluationComparisonHumanReview,
  Workspace,
} from "@osva/domain";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createDatabase, type Database } from "../../src/database.js";
import { migrateDatabase } from "../../src/migrate.js";
import { PostgresEvaluationComparisonHumanReviewRepository } from "../../src/repositories/postgres-evaluation-comparison-human-review-repository.js";
import { PostgresEvaluationComparisonPairwiseTaskRepository } from "../../src/repositories/postgres-evaluation-comparison-pairwise-task-repository.js";
import { PostgresEvaluationComparisonRepository } from "../../src/repositories/postgres-evaluation-comparison-repository.js";
import { PostgresWorkspaceRepository } from "../../src/repositories/postgres-workspace-repository.js";
import { NOW } from "./fixtures.js";
import {
  resetStage0Tables,
  startPostgresForTests,
  stopPostgresForTests,
  type PostgresTestContext,
} from "./postgres-harness.js";

const workspaceId = "ws-hr-rev" as WorkspaceId;
const comparisonId = "cmp-hr-rev" as EvaluationComparisonId;
const caseId = "ec-hr-case" as EvaluationCaseId;
const reviewerA = "user-reviewer-a" as UserId;
const reviewerB = "user-reviewer-b" as UserId;

describe("evaluation comparison human review revisions (PostgreSQL)", () => {
  let context: PostgresTestContext;
  let database: Database;
  let reviews: PostgresEvaluationComparisonHumanReviewRepository;

  beforeAll(async () => {
    context = await startPostgresForTests();
    database = createDatabase({
      connectionString: context.connectionString,
      max: 10,
      connectTimeoutSeconds: 10,
    });
    await migrateDatabase(database);
    reviews = new PostgresEvaluationComparisonHumanReviewRepository(database);
  });

  afterAll(async () => {
    await database?.close();
    if (context) {
      await stopPostgresForTests(context);
    }
  });

  async function seedComparisonParents(): Promise<void> {
    const { sql } = database;
    await sql`
      insert into evaluation_suites (id, workspace_id, key, name, created_at, updated_at)
      values ('es-hr-rev', ${workspaceId}, 'suite', 'Suite', ${NOW.toISOString()}, ${NOW.toISOString()})
    `;
    await sql`
      insert into evaluation_suite_versions (id, evaluation_suite_id, workspace_id, version, created_at)
      values ('esv-1', 'es-hr-rev', ${workspaceId}, 1, ${NOW.toISOString()})
    `;
    await sql`
      insert into evaluation_cases (id, evaluation_suite_version_id, key, input, evaluator, created_at)
      values
      (
        ${caseId},
        'esv-1',
        'case-1',
        '{"prompt":"x"}'::jsonb,
        '{"type":"JSON_EXACT_MATCH","expected":{}}'::jsonb,
        ${NOW.toISOString()}
      ),
      (
        'ec-2',
        'esv-1',
        'case-2',
        '{"prompt":"y"}'::jsonb,
        '{"type":"JSON_EXACT_MATCH","expected":{}}'::jsonb,
        ${NOW.toISOString()}
      ),
      (
        'ec-3',
        'esv-1',
        'case-3',
        '{"prompt":"z"}'::jsonb,
        '{"type":"JSON_EXACT_MATCH","expected":{}}'::jsonb,
        ${NOW.toISOString()}
      )
    `;
    await sql`
      insert into evaluation_runs (
        id, workspace_id, evaluation_suite_version_id, target_type, target_version_id, status, created_at, updated_at
      )
      values
      (
        'er-base',
        ${workspaceId},
        'esv-1',
        'AGENT_VERSION',
        'av-placeholder',
        'COMPLETED',
        ${NOW.toISOString()},
        ${NOW.toISOString()}
      ),
      (
        'er-cand',
        ${workspaceId},
        'esv-1',
        'AGENT_VERSION',
        'av-placeholder',
        'COMPLETED',
        ${NOW.toISOString()},
        ${NOW.toISOString()}
      )
    `;
  }

  beforeEach(async () => {
    await resetStage0Tables(database);
    const workspaces = new PostgresWorkspaceRepository(database);
    await workspaces.save(
      Workspace.create({
        id: workspaceId,
        name: "HR",
        createdAt: NOW,
      }),
    );
    await seedComparisonParents();
    const comparisons = new PostgresEvaluationComparisonRepository(database);
    await comparisons.saveComparisonIfAbsent(
      EvaluationComparison.create({
        id: comparisonId,
        workspaceId,
        baselineEvaluationRunId: "er-base" as never,
        candidateEvaluationRunId: "er-cand" as never,
        evaluationSuiteVersionId: "esv-1" as never,
        policySnapshot: {
          schemaVersion: 1,
          minComparisonCoverage: 0,
          minValidScoredPairs: 0,
          maxMeanPairedScoreRegression: 1,
          maxPerCaseScoreRegression: 1,
          maxNewlyFailingCriticalCases: 0,
          maxNewEvaluatorErrors: 0,
        },
        createdAt: NOW,
      }),
    );
  });

  it("appends superseding revisions and selects effective review", async () => {
    const firstId = "rev-1" as EvaluationComparisonHumanReviewRevisionId;
    const secondId = "rev-2" as EvaluationComparisonHumanReviewRevisionId;
    await reviews.appendReviewRevision({
      id: firstId,
      workspaceId,
      comparisonId,
      evaluationCaseId: caseId,
      reviewerUserId: reviewerA,
      decision: "TIE",
      evidenceReference: "rubric-v1",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
    });
    await reviews.appendReviewRevision({
      id: secondId,
      workspaceId,
      comparisonId,
      evaluationCaseId: caseId,
      reviewerUserId: reviewerA,
      decision: "CANDIDATE_BETTER",
      evidenceReference: "rubric-v1",
      supersedesRevisionId: firstId,
      createdAt: new Date("2026-01-02T00:00:00.000Z"),
    });

    const stored = await reviews.listReviewsByComparison(comparisonId);
    expect(stored).toHaveLength(2);

    const effective = await reviews.findEffectiveReviewForCase(
      comparisonId,
      caseId,
      reviewerA,
    );
    expect(effective?.id).toBe(secondId);
    expect(filterNonSupersededHumanReviews(stored).map((r) => r.id)).toEqual([
      secondId,
    ]);
  });

  it("rejects concurrent supersession of the same revision", async () => {
    const baseId = "rev-base" as EvaluationComparisonHumanReviewRevisionId;
    await reviews.appendReviewRevision({
      id: baseId,
      workspaceId,
      comparisonId,
      evaluationCaseId: caseId,
      reviewerUserId: reviewerA,
      decision: "BASELINE_BETTER",
      evidenceReference: "rubric-v1",
      createdAt: NOW,
    });

    const correctionA = reviews.appendReviewRevision({
      id: "rev-cor-a" as EvaluationComparisonHumanReviewRevisionId,
      workspaceId,
      comparisonId,
      evaluationCaseId: caseId,
      reviewerUserId: reviewerA,
      decision: "CANDIDATE_BETTER",
      evidenceReference: "rubric-v1",
      supersedesRevisionId: baseId,
      createdAt: new Date("2026-01-03T00:00:00.000Z"),
    });
    const correctionB = reviews.appendReviewRevision({
      id: "rev-cor-b" as EvaluationComparisonHumanReviewRevisionId,
      workspaceId,
      comparisonId,
      evaluationCaseId: caseId,
      reviewerUserId: reviewerA,
      decision: "TIE",
      evidenceReference: "rubric-v1",
      supersedesRevisionId: baseId,
      createdAt: new Date("2026-01-03T00:00:01.000Z"),
    });

    const results = await Promise.allSettled([correctionA, correctionB]);
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({
      message: "human_review_supersession_conflict",
    });

    const effective = await reviews.findEffectiveReviewForCase(
      comparisonId,
      caseId,
      reviewerA,
    );
    expect(effective?.supersedesRevisionId).toBe(baseId);
    expect(
      await reviews.findReviewRevisionByWorkspaceAndId(workspaceId, baseId),
    ).not.toBeNull();
  });

  it("computes calibration from persisted reviews and pairwise preferences", async () => {
    await reviews.appendReviewRevision({
      id: "rev-cal-1" as EvaluationComparisonHumanReviewRevisionId,
      workspaceId,
      comparisonId,
      evaluationCaseId: caseId,
      reviewerUserId: reviewerA,
      decision: "CANDIDATE_BETTER",
      evidenceReference: "rubric-v1",
      createdAt: NOW,
    });
    await reviews.appendReviewRevision({
      id: "rev-cal-2" as EvaluationComparisonHumanReviewRevisionId,
      workspaceId,
      comparisonId,
      evaluationCaseId: "ec-2" as EvaluationCaseId,
      reviewerUserId: reviewerA,
      decision: "UNSURE",
      evidenceReference: "rubric-v1",
      createdAt: NOW,
    });
    await reviews.appendReviewRevision({
      id: "rev-cal-3" as EvaluationComparisonHumanReviewRevisionId,
      workspaceId,
      comparisonId,
      evaluationCaseId: "ec-3" as EvaluationCaseId,
      reviewerUserId: reviewerA,
      decision: "BASELINE_BETTER",
      evidenceReference: "rubric-v1",
      createdAt: NOW,
    });
    await reviews.appendReviewRevision({
      id: "rev-cal-4" as EvaluationComparisonHumanReviewRevisionId,
      workspaceId,
      comparisonId,
      evaluationCaseId: "ec-3" as EvaluationCaseId,
      reviewerUserId: reviewerB,
      decision: "CANDIDATE_BETTER",
      evidenceReference: "rubric-v1",
      createdAt: NOW,
    });

    const all = await reviews.listReviewsByComparison(comparisonId);
    const consensus = consensusHumanDecisionByCase(all);
    expect(consensus.has(caseId)).toBe(true);
    expect(consensus.has("ec-3" as EvaluationCaseId)).toBe(false);

    const report = computeHumanJudgeCalibration([
      {
        judgePreference: "CANDIDATE_BETTER",
        humanDecision: "CANDIDATE_BETTER",
      },
      { judgePreference: "TIE", humanDecision: "UNSURE" },
    ]);
    expect(report.eligiblePairedLabelCount).toBe(1);
    expect(report.humanUnsureCount).toBe(1);
    expect(report.unavailableReason).toBeUndefined();
  });

  it("rejects superseding another reviewer's revision at application layer", async () => {
    const baseId = "rev-other" as EvaluationComparisonHumanReviewRevisionId;
    await reviews.appendReviewRevision({
      id: baseId,
      workspaceId,
      comparisonId,
      evaluationCaseId: caseId,
      reviewerUserId: reviewerB,
      decision: "TIE",
      evidenceReference: "rubric-v1",
      createdAt: NOW,
    });
    const submit = new SubmitEvaluationComparisonHumanReview({
      comparisons: new PostgresEvaluationComparisonRepository(database),
      pairwiseTasks: new PostgresEvaluationComparisonPairwiseTaskRepository(
        database,
      ),
      humanReviews: reviews,
      evaluationSuites: {
        findSuiteVersionById: async () => ({
          id: "esv-1",
          workspaceId,
          cases: [{ id: caseId }],
        }),
      } as never,
      runs: {} as never,
      clock: { now: () => NOW },
      ids: { createId: () => "unused" },
    });
    await expect(
      submit.execute(
        {
          principal: {
            authenticationMethod: AUTHENTICATION_METHODS.HUMAN_SESSION,
            userId: reviewerA,
            sessionId: "sess-a",
            workspaceId,
            humanRole: HUMAN_WORKSPACE_ROLES.DEVELOPER,
          },
        },
        comparisonId,
        {
          reviewerUserId: reviewerA,
          evaluationCaseId: caseId,
          decision: "CANDIDATE_BETTER",
          supersedesRevisionId: baseId,
        },
      ),
    ).rejects.toMatchObject({ message: "human_review_supersession_invalid" });
  });
});
