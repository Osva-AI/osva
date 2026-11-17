import type {
  CreateEvaluationComparisonInputV1,
  EvaluationCaseId,
  EvaluationComparisonHumanReviewRevisionId,
  EvaluationComparisonId,
  EvaluationRunId,
  UserId,
  WorkspaceId,
} from "@osva-ai/contracts";
import {
  AUTHORIZATION_ACTIONS,
  DEFAULT_LLM_JUDGE_MAX_OUTPUT_TOKENS,
} from "@osva-ai/contracts";
import { isHumanSessionRequestPrincipal } from "@osva-ai/contracts";

import { computePairwiseRubricIdentity } from "./comparison/pairwise-rubric-identity.js";
import { ReconcileEvaluationComparison } from "./evaluation-comparison-reconciliation.js";
import { EvaluationComparison } from "./evaluation-comparison.js";
import { EvaluationComparisonPairwiseTask } from "./evaluation-comparison-pairwise-task.js";
import { TERMINAL_EVALUATION_RUN_STATES } from "./evaluation-run-state-machine.js";
import type { ControlPlaneScope } from "./control-plane.js";
import {
  controlPlaneWorkspaceId,
  requireControlPlaneAuthorization,
} from "./control-plane.js";
import { CONTROL_PLANE_RESOURCE_KINDS } from "./control-plane-resource-kinds.js";
import {
  EvaluationComparisonNotFoundError,
  EvaluationComparisonRequestError,
  EvaluationRunNotFoundError,
  EvaluationSuiteVersionNotFoundError,
  HumanPrincipalRequiredError,
} from "./errors.js";
import { PermissionDeniedError } from "./security-errors.js";
import {
  GetEvaluationComparison,
  GetEvaluationComparisonAssessment,
  GetEvaluationComparisonCalibration,
  ListEvaluationComparisonHumanReviews,
  ListEvaluationComparisonPairwiseResults,
  ListEvaluationComparisons,
} from "./evaluation-comparison-query-application.js";
import type { EvaluationSuiteRepository } from "./ports/evaluation-suite-repository.js";
import type { EvaluationComparisonRepository } from "./ports/evaluation-comparison-repository.js";
import type { EvaluationComparisonPairwiseTaskRepository } from "./ports/evaluation-comparison-pairwise-task-repository.js";
import type { EvaluationComparisonHumanReviewRepository } from "./ports/evaluation-comparison-human-review-repository.js";
import type { RunRepository } from "./ports/run-repository.js";
import type { EvaluationComparisonHumanReviewRevision } from "./ports/evaluation-comparison-human-review-repository.js";

const EVALUATION_RUN_RESOURCE = {
  kind: CONTROL_PLANE_RESOURCE_KINDS.evaluationRun,
};

export interface EvaluationComparisonApplicationDependencies {
  readonly comparisons: EvaluationComparisonRepository;
  readonly pairwiseTasks: EvaluationComparisonPairwiseTaskRepository;
  readonly humanReviews: EvaluationComparisonHumanReviewRepository;
  readonly evaluationSuites: EvaluationSuiteRepository;
  readonly runs: RunRepository;
  readonly clock: { now(): Date };
  readonly ids: { createId(): string };
}

export class CreateEvaluationComparison {
  constructor(
    private readonly deps: EvaluationComparisonApplicationDependencies,
  ) {}

  async execute(
    scope: ControlPlaneScope,
    command: CreateEvaluationComparisonInputV1,
  ): Promise<EvaluationComparison> {
    requireControlPlaneAuthorization(
      scope,
      AUTHORIZATION_ACTIONS.EXECUTE,
      EVALUATION_RUN_RESOURCE,
    );
    const workspaceId = controlPlaneWorkspaceId(scope);

    if (command.baselineEvaluationRunId === command.candidateEvaluationRunId) {
      throw new EvaluationComparisonRequestError(
        "comparison_duplicate_run_ids",
      );
    }

    const baseline = await this.deps.evaluationSuites.findEvaluationRunById(
      command.baselineEvaluationRunId,
    );
    const candidate = await this.deps.evaluationSuites.findEvaluationRunById(
      command.candidateEvaluationRunId,
    );
    if (baseline === null) {
      throw new EvaluationRunNotFoundError(command.baselineEvaluationRunId);
    }
    if (candidate === null) {
      throw new EvaluationRunNotFoundError(command.candidateEvaluationRunId);
    }
    if (baseline.workspaceId !== workspaceId) {
      throw new EvaluationRunNotFoundError(command.baselineEvaluationRunId);
    }
    if (candidate.workspaceId !== workspaceId) {
      throw new EvaluationRunNotFoundError(command.candidateEvaluationRunId);
    }
    if (
      baseline.evaluationSuiteVersionId !== candidate.evaluationSuiteVersionId
    ) {
      throw new EvaluationComparisonRequestError(
        "comparison_suite_version_mismatch",
      );
    }
    if (
      !TERMINAL_EVALUATION_RUN_STATES.includes(
        baseline.status as (typeof TERMINAL_EVALUATION_RUN_STATES)[number],
      ) ||
      !TERMINAL_EVALUATION_RUN_STATES.includes(
        candidate.status as (typeof TERMINAL_EVALUATION_RUN_STATES)[number],
      )
    ) {
      throw new EvaluationComparisonRequestError("comparison_run_not_terminal");
    }

    const existing = await this.deps.comparisons.findByRunPair(
      command.baselineEvaluationRunId,
      command.candidateEvaluationRunId,
    );
    if (existing !== null) {
      return existing;
    }

    const suiteVersion = await this.deps.evaluationSuites.findSuiteVersionById(
      baseline.evaluationSuiteVersionId,
    );
    if (suiteVersion === null) {
      throw new EvaluationSuiteVersionNotFoundError(
        baseline.evaluationSuiteVersionId,
      );
    }

    const pairwiseConfig =
      command.pairwise?.enabled === true ? command.pairwise : undefined;
    const rubricIdentity =
      pairwiseConfig === undefined
        ? undefined
        : computePairwiseRubricIdentity({
            evaluationSuiteVersionId: suiteVersion.id,
            policy: command.policy,
            pairwise: pairwiseConfig,
          });

    const now = this.deps.clock.now();
    const comparison = EvaluationComparison.create({
      id: this.deps.ids.createId() as EvaluationComparisonId,
      workspaceId,
      baselineEvaluationRunId: command.baselineEvaluationRunId,
      candidateEvaluationRunId: command.candidateEvaluationRunId,
      evaluationSuiteVersionId: suiteVersion.id,
      policySnapshot: command.policy,
      pairwiseConfig,
      pairwiseRubricIdentity: rubricIdentity,
      createdAt: now,
    });

    await this.deps.comparisons.saveComparisonIfAbsent(comparison);

    if (pairwiseConfig !== undefined) {
      await this.schedulePairwiseTasks(
        comparison.id,
        workspaceId,
        suiteVersion.cases,
        pairwiseConfig,
        rubricIdentity!,
        command.baselineEvaluationRunId,
        command.candidateEvaluationRunId,
        now,
      );
    }

    await new ReconcileEvaluationComparison(this.deps).execute(
      comparison.id,
      workspaceId,
    );
    const stored = await this.deps.comparisons.findComparisonByWorkspaceAndId(
      workspaceId,
      comparison.id,
    );
    if (stored === null) {
      throw new EvaluationComparisonNotFoundError(comparison.id);
    }
    return stored;
  }

  private async schedulePairwiseTasks(
    comparisonId: EvaluationComparisonId,
    workspaceId: WorkspaceId,
    cases: readonly {
      readonly id: EvaluationCaseId;
      readonly input: unknown;
      readonly expected?: unknown;
    }[],
    pairwise: NonNullable<CreateEvaluationComparisonInputV1["pairwise"]>,
    rubricIdentity: string,
    baselineRunId: EvaluationRunId,
    candidateRunId: EvaluationRunId,
    now: Date,
  ): Promise<void> {
    const outputs = await this.loadCaseOutputs(
      workspaceId,
      baselineRunId,
      candidateRunId,
    );

    const positions = [
      "PRIMARY" as const,
      ...(pairwise.mitigatePositionBias === true
        ? (["REVERSED"] as const)
        : []),
    ];

    for (const evaluationCase of cases) {
      const caseOutputs = outputs.get(evaluationCase.id);
      if (
        caseOutputs === undefined ||
        caseOutputs.baselineOutput === null ||
        caseOutputs.baselineOutput === undefined ||
        caseOutputs.candidateOutput === null ||
        caseOutputs.candidateOutput === undefined
      ) {
        continue;
      }
      for (const position of positions) {
        const task = EvaluationComparisonPairwiseTask.create({
          id: this.deps.ids.createId() as never,
          workspaceId,
          comparisonId,
          evaluationCaseId: evaluationCase.id,
          judgmentPosition: position,
          snapshot: {
            rubricIdentity,
            modelProfileVersionId: pairwise.modelProfileVersionId,
            maxOutputTokens:
              pairwise.maxOutputTokens ?? DEFAULT_LLM_JUDGE_MAX_OUTPUT_TOKENS,
            caseInput: evaluationCase.input,
            caseExpected: evaluationCase.expected,
            baselineAnswer: caseOutputs.baselineOutput,
            candidateAnswer: caseOutputs.candidateOutput,
            rubric: pairwise.rubric,
            instructions: pairwise.instructions,
            judgmentPosition: position,
          },
          createdAt: now,
        });
        await this.deps.pairwiseTasks.savePairwiseTaskIfAbsent(task);
      }
    }
  }

  private async loadCaseOutputs(
    workspaceId: WorkspaceId,
    baselineRunId: EvaluationRunId,
    candidateRunId: EvaluationRunId,
  ) {
    const map = new Map<
      string,
      { baselineOutput: unknown; candidateOutput: unknown }
    >();

    for (const [runId, slot] of [
      [baselineRunId, "baseline"] as const,
      [candidateRunId, "candidate"] as const,
    ]) {
      const childRuns = await this.deps.runs.listRunsByEvaluationRunId(
        workspaceId,
        runId,
      );
      for (const child of childRuns) {
        if (child.evaluationCaseId === undefined) {
          continue;
        }
        const attempts = await this.deps.runs.listRunAttemptsForRuns([
          child.id,
        ]);
        const terminal = attempts
          .filter((attempt) => attempt.status === "SUCCEEDED")
          .sort((a, b) => b.sequence - a.sequence)[0];
        if (terminal?.output === undefined) {
          continue;
        }
        const prior = map.get(child.evaluationCaseId);
        map.set(child.evaluationCaseId, {
          baselineOutput:
            slot === "baseline"
              ? terminal.output
              : (prior?.baselineOutput ?? null),
          candidateOutput:
            slot === "candidate"
              ? terminal.output
              : (prior?.candidateOutput ?? null),
        });
      }
    }

    void workspaceId;
    return map;
  }
}

export class SubmitEvaluationComparisonHumanReview {
  constructor(
    private readonly deps: EvaluationComparisonApplicationDependencies,
  ) {}

  async execute(
    scope: ControlPlaneScope,
    comparisonId: EvaluationComparisonId,
    input: {
      readonly reviewerUserId: UserId;
      readonly evaluationCaseId: EvaluationCaseId;
      readonly decision: import("@osva-ai/contracts").EvaluationComparisonHumanDecision;
      readonly rationale?: string;
      readonly supersedesRevisionId?: EvaluationComparisonHumanReviewRevisionId;
    },
  ): Promise<EvaluationComparisonHumanReviewRevision> {
    if (!isHumanSessionRequestPrincipal(scope.principal)) {
      throw new HumanPrincipalRequiredError();
    }
    requireControlPlaneAuthorization(
      scope,
      AUTHORIZATION_ACTIONS.WRITE,
      EVALUATION_RUN_RESOURCE,
    );
    const workspaceId = controlPlaneWorkspaceId(scope);
    if (input.reviewerUserId !== scope.principal.userId) {
      throw new PermissionDeniedError();
    }

    const comparison =
      await this.deps.comparisons.findComparisonByWorkspaceAndId(
        workspaceId,
        comparisonId,
      );
    if (comparison === null) {
      throw new EvaluationComparisonNotFoundError(comparisonId);
    }

    const suiteVersion = await this.deps.evaluationSuites.findSuiteVersionById(
      comparison.evaluationSuiteVersionId,
    );
    if (
      suiteVersion === null ||
      suiteVersion.workspaceId !== workspaceId ||
      !suiteVersion.cases.some((c) => c.id === input.evaluationCaseId)
    ) {
      throw new EvaluationComparisonRequestError("comparison_case_invalid");
    }

    if (input.supersedesRevisionId !== undefined) {
      const prior =
        await this.deps.humanReviews.findReviewRevisionByWorkspaceAndId(
          workspaceId,
          input.supersedesRevisionId,
        );
      if (
        prior === null ||
        prior.comparisonId !== comparisonId ||
        prior.evaluationCaseId !== input.evaluationCaseId ||
        prior.reviewerUserId !== input.reviewerUserId
      ) {
        throw new EvaluationComparisonRequestError(
          "human_review_supersession_invalid",
        );
      }
    }

    const evidenceReference =
      comparison.pairwiseRubricIdentity ??
      comparison.policySnapshot.schemaVersion.toString();

    const revision: EvaluationComparisonHumanReviewRevision = {
      id: this.deps.ids.createId() as EvaluationComparisonHumanReviewRevisionId,
      workspaceId,
      comparisonId,
      evaluationCaseId: input.evaluationCaseId,
      reviewerUserId: input.reviewerUserId,
      decision: input.decision,
      rationale: input.rationale,
      evidenceReference,
      supersedesRevisionId: input.supersedesRevisionId,
      createdAt: this.deps.clock.now(),
    };

    await this.deps.humanReviews.appendReviewRevision(revision);
    return revision;
  }
}

export function createEvaluationComparisonApplication(
  deps: EvaluationComparisonApplicationDependencies,
) {
  return {
    createComparison: new CreateEvaluationComparison(deps),
    submitHumanReview: new SubmitEvaluationComparisonHumanReview(deps),
    listComparisons: new ListEvaluationComparisons(deps),
    getComparison: new GetEvaluationComparison(deps),
    listPairwiseResults: new ListEvaluationComparisonPairwiseResults(deps),
    getAssessment: new GetEvaluationComparisonAssessment(deps),
    listHumanReviews: new ListEvaluationComparisonHumanReviews(deps),
    getCalibration: new GetEvaluationComparisonCalibration(deps),
  };
}

export type EvaluationComparisonApplication = ReturnType<
  typeof createEvaluationComparisonApplication
>;
