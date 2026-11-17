import type {
  EvaluationComparisonId,
  EvaluationComparisonPairwisePreference,
} from "@osva-ai/contracts";
import { AUTHORIZATION_ACTIONS } from "@osva-ai/contracts";

import { computeHumanJudgeCalibration } from "./comparison/calibration.js";
import { consensusHumanDecisionByCase } from "./comparison/human-review-effective.js";
import {
  controlPlaneWorkspaceId,
  requireControlPlaneAuthorization,
  type ControlPlaneScope,
} from "./control-plane.js";
import { CONTROL_PLANE_RESOURCE_KINDS } from "./control-plane-resource-kinds.js";
import type { EvaluationComparison } from "./evaluation-comparison.js";
import type { EvaluationComparisonApplicationDependencies } from "./evaluation-comparison-application.js";
import { EvaluationComparisonNotFoundError } from "./errors.js";
import {
  DEFAULT_EVALUATION_COMPARISON_LIST_LIMIT,
  MAX_EVALUATION_COMPARISON_LIST_LIMIT,
  type ListEvaluationComparisonsQuery,
} from "./ports/evaluation-comparison-repository.js";
import type { EvaluationComparisonHumanReviewRevision } from "./ports/evaluation-comparison-human-review-repository.js";
import type { EvaluationComparisonPairwiseTask } from "./evaluation-comparison-pairwise-task.js";

const EVALUATION_RUN_RESOURCE = {
  kind: CONTROL_PLANE_RESOURCE_KINDS.evaluationRun,
};

export class ListEvaluationComparisons {
  constructor(
    private readonly deps: EvaluationComparisonApplicationDependencies,
  ) {}

  async execute(
    scope: ControlPlaneScope,
    query: Omit<ListEvaluationComparisonsQuery, "workspaceId">,
  ) {
    requireControlPlaneAuthorization(
      scope,
      AUTHORIZATION_ACTIONS.READ,
      EVALUATION_RUN_RESOURCE,
    );
    const workspaceId = controlPlaneWorkspaceId(scope);
    const limit = clampListLimit(query.limit);
    return this.deps.comparisons.listComparisons({
      ...query,
      workspaceId,
      limit,
    });
  }
}

export class GetEvaluationComparison {
  constructor(
    private readonly deps: EvaluationComparisonApplicationDependencies,
  ) {}

  async execute(
    scope: ControlPlaneScope,
    comparisonId: EvaluationComparisonId,
  ): Promise<EvaluationComparison> {
    requireControlPlaneAuthorization(
      scope,
      AUTHORIZATION_ACTIONS.READ,
      EVALUATION_RUN_RESOURCE,
    );
    const workspaceId = controlPlaneWorkspaceId(scope);
    const comparison =
      await this.deps.comparisons.findComparisonByWorkspaceAndId(
        workspaceId,
        comparisonId,
      );
    if (comparison === null) {
      throw new EvaluationComparisonNotFoundError(comparisonId);
    }
    return comparison;
  }
}

export class ListEvaluationComparisonPairwiseResults {
  constructor(
    private readonly deps: EvaluationComparisonApplicationDependencies,
  ) {}

  async execute(
    scope: ControlPlaneScope,
    comparisonId: EvaluationComparisonId,
  ): Promise<readonly EvaluationComparisonPairwiseTask[]> {
    requireControlPlaneAuthorization(
      scope,
      AUTHORIZATION_ACTIONS.READ,
      EVALUATION_RUN_RESOURCE,
    );
    const workspaceId = controlPlaneWorkspaceId(scope);
    const comparison =
      await this.deps.comparisons.findComparisonByWorkspaceAndId(
        workspaceId,
        comparisonId,
      );
    if (comparison === null) {
      throw new EvaluationComparisonNotFoundError(comparisonId);
    }
    return this.deps.pairwiseTasks.listPairwiseTasksByComparison(
      workspaceId,
      comparisonId,
    );
  }
}

export class GetEvaluationComparisonAssessment {
  constructor(
    private readonly deps: EvaluationComparisonApplicationDependencies,
  ) {}

  async execute(
    scope: ControlPlaneScope,
    comparisonId: EvaluationComparisonId,
  ) {
    const comparison = await new GetEvaluationComparison(this.deps).execute(
      scope,
      comparisonId,
    );
    return {
      comparisonId: comparison.id,
      status: comparison.status,
      regressionAssessment: comparison.regressionAssessment,
      promotion: comparison.promotion,
      policy: comparison.policySnapshot,
      completedAt: comparison.completedAt,
    };
  }
}

export class ListEvaluationComparisonHumanReviews {
  constructor(
    private readonly deps: EvaluationComparisonApplicationDependencies,
  ) {}

  async execute(
    scope: ControlPlaneScope,
    comparisonId: EvaluationComparisonId,
  ): Promise<readonly EvaluationComparisonHumanReviewRevision[]> {
    requireControlPlaneAuthorization(
      scope,
      AUTHORIZATION_ACTIONS.READ,
      EVALUATION_RUN_RESOURCE,
    );
    const workspaceId = controlPlaneWorkspaceId(scope);
    const comparison =
      await this.deps.comparisons.findComparisonByWorkspaceAndId(
        workspaceId,
        comparisonId,
      );
    if (comparison === null) {
      throw new EvaluationComparisonNotFoundError(comparisonId);
    }
    const revisions =
      await this.deps.humanReviews.listReviewsByComparison(comparisonId);
    return revisions.filter((revision) => revision.workspaceId === workspaceId);
  }
}

export class GetEvaluationComparisonCalibration {
  constructor(
    private readonly deps: EvaluationComparisonApplicationDependencies,
  ) {}

  async execute(
    scope: ControlPlaneScope,
    comparisonId: EvaluationComparisonId,
  ) {
    const comparison = await new GetEvaluationComparison(this.deps).execute(
      scope,
      comparisonId,
    );
    const workspaceId = controlPlaneWorkspaceId(scope);
    const tasks = await this.deps.pairwiseTasks.listPairwiseTasksByComparison(
      workspaceId,
      comparisonId,
    );
    const primaryPreferences = new Map<
      string,
      EvaluationComparisonPairwisePreference
    >();
    for (const task of tasks) {
      if (task.judgmentPosition !== "PRIMARY" || task.status !== "SUCCEEDED") {
        continue;
      }
      const pref = task.terminalResult?.verdict?.canonicalPreference;
      if (typeof pref === "string") {
        primaryPreferences.set(
          task.evaluationCaseId,
          pref as EvaluationComparisonPairwisePreference,
        );
      }
    }

    const reviews =
      await this.deps.humanReviews.listReviewsByComparison(comparisonId);
    const workspaceReviews = reviews.filter(
      (r) => r.workspaceId === workspaceId,
    );
    const consensus = consensusHumanDecisionByCase(workspaceReviews);

    const rows: {
      readonly judgePreference?: EvaluationComparisonPairwisePreference;
      readonly humanDecision?: import("@osva-ai/contracts").EvaluationComparisonHumanDecision;
    }[] = [];

    for (const [caseId, humanRevision] of consensus) {
      const judgePreference = primaryPreferences.get(caseId);
      rows.push({
        judgePreference,
        humanDecision: humanRevision.decision,
      });
    }

    const report = computeHumanJudgeCalibration(rows);
    const modelProfileVersionId =
      comparison.pairwiseConfig?.modelProfileVersionId;

    return {
      comparisonId: comparison.id,
      judgeRubricIdentity: comparison.pairwiseRubricIdentity,
      modelProfileVersionId,
      ...report,
    };
  }
}

function clampListLimit(limit: number): number {
  const defaulted =
    limit > 0 ? limit : DEFAULT_EVALUATION_COMPARISON_LIST_LIMIT;
  return Math.min(defaulted, MAX_EVALUATION_COMPARISON_LIST_LIMIT);
}
