import type {
  EvaluationCaseId,
  EvaluationComparisonId,
  EvaluationComparisonPolicyV1,
  EvaluationRunId,
  EvaluationSuiteVersionId,
  ModelProfileVersionId,
  WorkspaceId,
} from "@osva-ai/contracts";
import {
  EVALUATION_COMPARISON_PAIRWISE_CONFIG_SCHEMA_VERSION,
  EVALUATION_COMPARISON_POLICY_SCHEMA_VERSION,
} from "@osva-ai/contracts";
import type { EvaluationJudgeModelInvoker } from "@osva/domain";
import {
  CreateEvaluationComparison,
  ModelProfile,
  ModelProfileVersion,
  runtimeControlPlaneScope,
  type EvaluationComparison,
} from "@osva/domain";

import type { Database } from "../../src/database.js";
import { PostgresEvaluationComparisonHumanReviewRepository } from "../../src/repositories/postgres-evaluation-comparison-human-review-repository.js";
import { PostgresEvaluationComparisonPairwiseTaskRepository } from "../../src/repositories/postgres-evaluation-comparison-pairwise-task-repository.js";
import { PostgresEvaluationComparisonRepository } from "../../src/repositories/postgres-evaluation-comparison-repository.js";
import { PostgresEvaluationSuiteRepository } from "../../src/repositories/postgres-evaluation-suite-repository.js";
import { PostgresModelProfileRepository } from "../../src/repositories/postgres-model-profile-repository.js";
import { PostgresRunRepository } from "../../src/repositories/postgres-run-repository.js";

import { NOW } from "./fixtures.js";

export const E2E_WORKSPACE = "ws-a5-e2e" as WorkspaceId;
export const E2E_MPV = "mpv-a5-e2e" as ModelProfileVersionId;
export const E2E_BASE_RUN = "erun-a5-base" as EvaluationRunId;
export const E2E_CAND_RUN = "erun-a5-cand" as EvaluationRunId;
export const E2E_SUITE_VERSION = "esv-a5-e2e" as EvaluationSuiteVersionId;

export const E2E_CASE_A = "case-a5-a" as EvaluationCaseId;
export const E2E_CASE_B = "case-a5-b" as EvaluationCaseId;
export const E2E_CASE_C = "case-a5-c" as EvaluationCaseId;

export const E2E_CASE_IDS = [E2E_CASE_A, E2E_CASE_B, E2E_CASE_C] as const;

export function promoteFriendlyPolicy(
  overrides?: Partial<EvaluationComparisonPolicyV1>,
): EvaluationComparisonPolicyV1 {
  return {
    schemaVersion: EVALUATION_COMPARISON_POLICY_SCHEMA_VERSION,
    minComparisonCoverage: 1,
    minValidScoredPairs: 2,
    maxMeanPairedScoreRegression: 0.5,
    maxPerCaseScoreRegression: 0.5,
    maxNewlyFailingCriticalCases: 999,
    maxNewEvaluatorErrors: 999,
    ...overrides,
  };
}

export function createPairwiseInvoker(
  preference: "A_BETTER" | "B_BETTER" | "TIE",
  options?: {
    readonly usageIncomplete?: boolean;
    readonly pricedCostUsdMicros?: number;
  },
): EvaluationJudgeModelInvoker {
  return {
    generateJudgeCompletion: async () => ({
      text: JSON.stringify({
        preference,
        reason: "Structured acceptance verdict.",
        evidence: ["Fixture evidence."],
      }),
      inputTokens: 120,
      outputTokens: 40,
      configuredProviderModelId: "gpt-4o-mini",
      providerReportedModelId: "gpt-4o-mini",
      ...(options?.usageIncomplete === true ? { usageIncomplete: true } : {}),
      ...(options?.pricedCostUsdMicros !== undefined
        ? { pricedCostUsdMicros: options.pricedCostUsdMicros }
        : {}),
    }),
  };
}

export interface E2eScoreRow {
  readonly caseId: EvaluationCaseId;
  readonly caseKey: string;
  readonly baselineScore: number;
  readonly candidateScore: number;
  readonly baselineOutput: unknown;
  readonly candidateOutput: unknown;
}

export interface E2eGraphSeed {
  readonly comparisonId: EvaluationComparisonId;
  readonly comparison?: EvaluationComparison;
}

export async function seedModelProfile(database: Database): Promise<void> {
  const modelProfiles = new PostgresModelProfileRepository(database);
  const profile = ModelProfile.create({
    id: "mp-a5-e2e" as never,
    workspaceId: E2E_WORKSPACE,
    key: "judge-e2e",
    name: "Judge E2E",
    createdAt: NOW,
  });
  await modelProfiles.saveModelProfile(profile);
  await modelProfiles.saveModelProfileVersion(
    ModelProfileVersion.create({
      id: E2E_MPV,
      modelProfileId: profile.id,
      version: 1,
      provider: "OPENAI",
      model: "gpt-4o-mini",
      createdAt: NOW,
    }),
  );
}

export async function seedEvaluationGraph(
  database: Database,
  scores: readonly E2eScoreRow[],
  options?: { readonly criticalCaseId?: EvaluationCaseId },
): Promise<void> {
  const { sql } = database;
  await sql`
    insert into evaluation_suites (id, workspace_id, key, name, created_at, updated_at)
    values ('es-a5-e2e', ${E2E_WORKSPACE}, 'suite-a5', 'A5 E2E', ${NOW.toISOString()}, ${NOW.toISOString()})
  `;
  await sql`
    insert into evaluation_suite_versions (id, evaluation_suite_id, workspace_id, version, created_at)
    values (${E2E_SUITE_VERSION}, 'es-a5-e2e', ${E2E_WORKSPACE}, 1, ${NOW.toISOString()})
  `;

  for (const row of scores) {
    await sql`
      insert into evaluation_cases (id, evaluation_suite_version_id, key, input, evaluator, created_at)
      values (
        ${row.caseId},
        ${E2E_SUITE_VERSION},
        ${row.caseKey},
        '{"prompt":"test"}'::jsonb,
        '{"type":"JSON_EXACT_MATCH","expected":{}}'::jsonb,
        ${NOW.toISOString()}
      )
    `;
  }

  await sql`
    insert into agents (id, workspace_id, key, name, created_at)
    values ('agent-a5-e2e', ${E2E_WORKSPACE}, 'a5', 'A5 Agent', ${NOW.toISOString()})
  `;
  await sql`
    insert into agent_versions (id, agent_id, version, manifest, created_at)
    values (
      'av-a5-e2e',
      'agent-a5-e2e',
      1,
      '{"schemaVersion":"1","key":"a5","name":"A5","runtime":{"type":"BUILTIN_PACKAGE","key":"a5"},"input":{"schema":{}},"output":{"schema":{}},"execution":{"timeoutMs":1000,"maxAttempts":1},"capabilities":{"model":false,"tools":[]}}'::jsonb,
      ${NOW.toISOString()}
    )
  `;

  await sql`
    insert into evaluation_runs (
      id, workspace_id, evaluation_suite_version_id, target_type, target_version_id, status, created_at, updated_at
    )
    values
    (
      ${E2E_BASE_RUN},
      ${E2E_WORKSPACE},
      ${E2E_SUITE_VERSION},
      'AGENT_VERSION',
      'av-a5-e2e',
      'COMPLETED',
      ${NOW.toISOString()},
      ${NOW.toISOString()}
    ),
    (
      ${E2E_CAND_RUN},
      ${E2E_WORKSPACE},
      ${E2E_SUITE_VERSION},
      'AGENT_VERSION',
      'av-a5-e2e',
      'COMPLETED',
      ${NOW.toISOString()},
      ${NOW.toISOString()}
    )
  `;

  let caseIndex = 0;
  for (const row of scores) {
    caseIndex += 1;
    const baseRunId = `run-base-${caseIndex}`;
    const candRunId = `run-cand-${caseIndex}`;
    const baseAttemptId = `ra-base-${caseIndex}`;
    const candAttemptId = `ra-cand-${caseIndex}`;
    await sql`
      insert into runs (
        id, workspace_id, agent_id, status, agent_version_id, evaluation_run_id, evaluation_case_id,
        model_profile_version_bindings, tool_version_bindings, memory_namespace_bindings, knowledge_index_bindings,
        input, created_at, updated_at
      )
      values
      (
        ${baseRunId},
        ${E2E_WORKSPACE},
        'agent-a5-e2e',
        'SUCCEEDED',
        'av-a5-e2e',
        ${E2E_BASE_RUN},
        ${row.caseId},
        '{}'::jsonb,
        '{}'::jsonb,
        '{}'::jsonb,
        '{}'::jsonb,
        '{"prompt":"test"}'::jsonb,
        ${NOW.toISOString()},
        ${NOW.toISOString()}
      ),
      (
        ${candRunId},
        ${E2E_WORKSPACE},
        'agent-a5-e2e',
        'SUCCEEDED',
        'av-a5-e2e',
        ${E2E_CAND_RUN},
        ${row.caseId},
        '{}'::jsonb,
        '{}'::jsonb,
        '{}'::jsonb,
        '{}'::jsonb,
        '{"prompt":"test"}'::jsonb,
        ${NOW.toISOString()},
        ${NOW.toISOString()}
      )
    `;
    await sql`
      insert into run_attempts (id, run_id, sequence, status, output, created_at)
      values
      (
        ${baseAttemptId},
        ${baseRunId},
        1,
        'SUCCEEDED',
        ${JSON.stringify(row.baselineOutput)}::jsonb,
        ${NOW.toISOString()}
      ),
      (
        ${candAttemptId},
        ${candRunId},
        1,
        'SUCCEEDED',
        ${JSON.stringify(row.candidateOutput)}::jsonb,
        ${NOW.toISOString()}
      )
    `;

    const baseOutcome = row.baselineScore >= 0.5 ? "PASS" : "FAIL";
    const candOutcome = row.candidateScore >= 0.5 ? "PASS" : "FAIL";
    const resultBaseId = `ecr-base-${caseIndex}`;
    const resultCandId = `ecr-cand-${caseIndex}`;

    await sql`
      insert into evaluation_case_results (
        id, evaluation_run_id, evaluation_case_id, run_id, outcome, evaluator_results, created_at, completed_at
      )
      values
      (
        ${resultBaseId},
        ${E2E_BASE_RUN},
        ${row.caseId},
        ${baseRunId},
        ${baseOutcome},
        ${JSON.stringify({
          type: "JSON_EXACT_MATCH",
          score: row.baselineScore,
          passed: row.baselineScore >= 0.5,
        })}::jsonb,
        ${NOW.toISOString()},
        ${NOW.toISOString()}
      ),
      (
        ${resultCandId},
        ${E2E_CAND_RUN},
        ${row.caseId},
        ${candRunId},
        ${candOutcome},
        ${JSON.stringify({
          type: "JSON_EXACT_MATCH",
          score: row.candidateScore,
          passed: row.candidateScore >= 0.5,
        })}::jsonb,
        ${NOW.toISOString()},
        ${NOW.toISOString()}
      )
    `;
    void options;
  }
}

export async function createComparisonRecord(
  database: Database,
  policy: EvaluationComparisonPolicyV1,
  options?: {
    readonly comparisonId?: EvaluationComparisonId;
    readonly mitigatePositionBias?: boolean;
    readonly pairwiseEnabled?: boolean;
  },
): Promise<E2eGraphSeed> {
  const comparisons = new PostgresEvaluationComparisonRepository(database);
  const pairwiseTasks = new PostgresEvaluationComparisonPairwiseTaskRepository(
    database,
  );
  const humanReviews = new PostgresEvaluationComparisonHumanReviewRepository(
    database,
  );
  const evaluationSuites = new PostgresEvaluationSuiteRepository(database);
  const runs = new PostgresRunRepository(database);
  const comparisonId =
    options?.comparisonId ?? (`cmp-a5-${Date.now()}` as EvaluationComparisonId);
  let idSequence = 0;
  const createComparison = new CreateEvaluationComparison({
    comparisons,
    pairwiseTasks,
    humanReviews,
    evaluationSuites,
    runs,
    clock: { now: () => NOW },
    ids: {
      createId: () => {
        if (idSequence === 0) {
          idSequence += 1;
          return comparisonId;
        }
        idSequence += 1;
        return `pw-task-${comparisonId}-${String(idSequence)}`;
      },
    },
  });

  const pairwiseEnabled = options?.pairwiseEnabled !== false;
  const comparison = await createComparison.execute(
    runtimeControlPlaneScope(E2E_WORKSPACE),
    {
      baselineEvaluationRunId: E2E_BASE_RUN,
      candidateEvaluationRunId: E2E_CAND_RUN,
      policy,
      ...(pairwiseEnabled
        ? {
            pairwise: {
              schemaVersion:
                EVALUATION_COMPARISON_PAIRWISE_CONFIG_SCHEMA_VERSION,
              enabled: true,
              rubric: "Select the more accurate response.",
              modelProfileVersionId: E2E_MPV,
              ...(options?.mitigatePositionBias === true
                ? { mitigatePositionBias: true }
                : {}),
            },
          }
        : {}),
    },
  );

  return { comparisonId: comparison.id, comparison };
}

export function defaultImprovementScores(): readonly E2eScoreRow[] {
  return [
    {
      caseId: E2E_CASE_A,
      caseKey: "a",
      baselineScore: 0.4,
      candidateScore: 0.75,
      baselineOutput: "baseline-a",
      candidateOutput: "candidate-a",
    },
    {
      caseId: E2E_CASE_B,
      caseKey: "b",
      baselineScore: 0.45,
      candidateScore: 0.85,
      baselineOutput: "baseline-b",
      candidateOutput: "candidate-b",
    },
    {
      caseId: E2E_CASE_C,
      caseKey: "c",
      baselineScore: 0.5,
      candidateScore: 0.95,
      baselineOutput: "baseline-c",
      candidateOutput: "candidate-c",
    },
  ];
}

export function regressionScores(): readonly E2eScoreRow[] {
  return [
    {
      caseId: E2E_CASE_A,
      caseKey: "a",
      baselineScore: 0.9,
      candidateScore: 0.55,
      baselineOutput: "good",
      candidateOutput: "worse",
    },
    {
      caseId: E2E_CASE_B,
      caseKey: "b",
      baselineScore: 0.85,
      candidateScore: 0.6,
      baselineOutput: "good-b",
      candidateOutput: "worse-b",
    },
    {
      caseId: E2E_CASE_C,
      caseKey: "c",
      baselineScore: 0.8,
      candidateScore: 0.7,
      baselineOutput: "good-c",
      candidateOutput: "worse-c",
    },
  ];
}
