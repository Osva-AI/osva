import type {
  EvaluationComparisonCostSummaryV1,
  EvaluationComparisonDeterministicSummaryV1,
  EvaluationComparisonPairwiseConfigV1,
  EvaluationComparisonPairwiseSummaryV1,
  EvaluationComparisonPolicyV1,
  EvaluationComparisonPromotionV1,
  EvaluationComparisonRegressionAssessmentV1,
} from "@osva-ai/contracts";
import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import { evaluationCases } from "./evaluation-cases.js";
import { evaluationRuns } from "./evaluation-runs.js";
import { evaluationSuiteVersions } from "./evaluation-suite-versions.js";
import { sqlTextInList } from "./sql.js";

export const PERSISTED_EVALUATION_COMPARISON_STATES = [
  "PENDING",
  "RUNNING",
  "COMPLETED",
  "FAILED",
] as const;

export const evaluationComparisons = pgTable(
  "evaluation_comparisons",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    baselineEvaluationRunId: text("baseline_evaluation_run_id").notNull(),
    candidateEvaluationRunId: text("candidate_evaluation_run_id").notNull(),
    evaluationSuiteVersionId: text("evaluation_suite_version_id").notNull(),
    status: text("status").notNull(),
    policySnapshot: jsonb("policy_snapshot")
      .$type<EvaluationComparisonPolicyV1>()
      .notNull(),
    pairwiseConfig: jsonb(
      "pairwise_config",
    ).$type<EvaluationComparisonPairwiseConfigV1 | null>(),
    deterministicSummary: jsonb(
      "deterministic_summary",
    ).$type<EvaluationComparisonDeterministicSummaryV1 | null>(),
    pairwiseSummary: jsonb(
      "pairwise_summary",
    ).$type<EvaluationComparisonPairwiseSummaryV1 | null>(),
    regressionAssessment: jsonb(
      "regression_assessment",
    ).$type<EvaluationComparisonRegressionAssessmentV1 | null>(),
    promotion: jsonb(
      "promotion",
    ).$type<EvaluationComparisonPromotionV1 | null>(),
    costSummary: jsonb(
      "cost_summary",
    ).$type<EvaluationComparisonCostSummaryV1 | null>(),
    pairwiseRubricIdentity: text("pairwise_rubric_identity"),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
    updatedAt: timestamp("updated_at", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
    completedAt: timestamp("completed_at", {
      withTimezone: true,
      mode: "date",
    }),
  },
  (table) => [
    uniqueIndex("evaluation_comparisons_runs_unique").on(
      table.baselineEvaluationRunId,
      table.candidateEvaluationRunId,
    ),
    foreignKey({
      columns: [table.baselineEvaluationRunId],
      foreignColumns: [evaluationRuns.id],
      name: "evaluation_comparisons_baseline_run_fk",
    }),
    foreignKey({
      columns: [table.candidateEvaluationRunId],
      foreignColumns: [evaluationRuns.id],
      name: "evaluation_comparisons_candidate_run_fk",
    }),
    foreignKey({
      columns: [table.evaluationSuiteVersionId],
      foreignColumns: [evaluationSuiteVersions.id],
      name: "evaluation_comparisons_suite_version_fk",
    }),
    check(
      "evaluation_comparisons_status_check",
      sql`${table.status} in (${sqlTextInList(PERSISTED_EVALUATION_COMPARISON_STATES)})`,
    ),
    check(
      "evaluation_comparisons_distinct_runs",
      sql`${table.baselineEvaluationRunId} <> ${table.candidateEvaluationRunId}`,
    ),
    index("evaluation_comparisons_workspace_created_idx").on(
      table.workspaceId,
      table.createdAt,
      table.id,
    ),
  ],
);

export const PERSISTED_PAIRWISE_JUDGMENT_POSITIONS = [
  "PRIMARY",
  "REVERSED",
] as const;

export const evaluationComparisonPairwiseTasks = pgTable(
  "evaluation_comparison_pairwise_tasks",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    comparisonId: text("comparison_id").notNull(),
    evaluationCaseId: text("evaluation_case_id").notNull(),
    judgmentPosition: text("judgment_position").notNull(),
    snapshot: jsonb("snapshot")
      .$type<Readonly<Record<string, unknown>>>()
      .notNull(),
    status: text("status").notNull(),
    attemptCount: integer("attempt_count").notNull(),
    maxAttempts: integer("max_attempts").notNull(),
    executionOwner: text("execution_owner"),
    executionGeneration: integer("execution_generation").notNull().default(0),
    leaseExpiresAt: timestamp("lease_expires_at", {
      withTimezone: true,
      mode: "date",
    }),
    terminalResult:
      jsonb("terminal_result").$type<Readonly<Record<string, unknown>>>(),
    errorCode: text("error_code"),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
    updatedAt: timestamp("updated_at", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
    completedAt: timestamp("completed_at", {
      withTimezone: true,
      mode: "date",
    }),
  },
  (table) => [
    unique("evaluation_comparison_pairwise_tasks_case_position_unique").on(
      table.comparisonId,
      table.evaluationCaseId,
      table.judgmentPosition,
    ),
    foreignKey({
      columns: [table.comparisonId],
      foreignColumns: [evaluationComparisons.id],
      name: "evaluation_comparison_pairwise_tasks_comparison_fk",
    }),
    foreignKey({
      columns: [table.evaluationCaseId],
      foreignColumns: [evaluationCases.id],
      name: "evaluation_comparison_pairwise_tasks_case_fk",
    }),
    check(
      "evaluation_comparison_pairwise_tasks_status_check",
      sql`${table.status} in (${sqlTextInList(["PENDING", "RUNNING", "SUCCEEDED", "FAILED"])})`,
    ),
    check(
      "evaluation_comparison_pairwise_tasks_position_check",
      sql`${table.judgmentPosition} in (${sqlTextInList(PERSISTED_PAIRWISE_JUDGMENT_POSITIONS)})`,
    ),
    check(
      "evaluation_comparison_pairwise_tasks_attempt_count_positive",
      sql`${table.attemptCount} >= 0`,
    ),
    check(
      "evaluation_comparison_pairwise_tasks_max_attempts_positive",
      sql`${table.maxAttempts} > 0`,
    ),
    index("evaluation_comparison_pairwise_tasks_recovery_idx").on(
      table.status,
      table.leaseExpiresAt,
      table.createdAt,
      table.id,
    ),
  ],
);

export const PERSISTED_HUMAN_REVIEW_DECISIONS = [
  "BASELINE_BETTER",
  "CANDIDATE_BETTER",
  "TIE",
  "UNSURE",
] as const;

export const evaluationComparisonHumanReviewRevisions = pgTable(
  "evaluation_comparison_human_review_revisions",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    comparisonId: text("comparison_id").notNull(),
    evaluationCaseId: text("evaluation_case_id").notNull(),
    reviewerUserId: text("reviewer_user_id").notNull(),
    decision: text("decision").notNull(),
    rationale: text("rationale"),
    evidenceReference: text("evidence_reference").notNull(),
    supersedesRevisionId: text("supersedes_revision_id"),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.comparisonId],
      foreignColumns: [evaluationComparisons.id],
      name: "evaluation_comparison_human_reviews_comparison_fk",
    }),
    foreignKey({
      columns: [table.evaluationCaseId],
      foreignColumns: [evaluationCases.id],
      name: "evaluation_comparison_human_reviews_case_fk",
    }),
    check(
      "evaluation_comparison_human_review_decision_check",
      sql`${table.decision} in (${sqlTextInList(PERSISTED_HUMAN_REVIEW_DECISIONS)})`,
    ),
    index("evaluation_comparison_human_reviews_comparison_case_idx").on(
      table.comparisonId,
      table.evaluationCaseId,
      table.createdAt,
      table.id,
    ),
    uniqueIndex("evaluation_comparison_human_review_supersedes_unique")
      .on(table.supersedesRevisionId)
      .where(sql`${table.supersedesRevisionId} is not null`),
  ],
);
