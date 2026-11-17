import type {
  EvaluationComparisonCostSummaryV1,
  EvaluationComparisonDeterministicSummaryV1,
  EvaluationComparisonId,
  EvaluationComparisonPairwiseConfigV1,
  EvaluationComparisonPairwiseSummaryV1,
  EvaluationComparisonPolicyV1,
  EvaluationComparisonPromotionV1,
  EvaluationComparisonRegressionAssessmentV1,
  EvaluationComparisonState,
  EvaluationRunId,
  EvaluationSuiteVersionId,
  WorkspaceId,
} from "@osva-ai/contracts";
import { isEvaluationComparisonState } from "@osva-ai/contracts";

export interface EvaluationComparisonProps {
  readonly id: EvaluationComparisonId;
  readonly workspaceId: WorkspaceId;
  readonly baselineEvaluationRunId: EvaluationRunId;
  readonly candidateEvaluationRunId: EvaluationRunId;
  readonly evaluationSuiteVersionId: EvaluationSuiteVersionId;
  readonly status: EvaluationComparisonState;
  readonly policySnapshot: EvaluationComparisonPolicyV1;
  readonly pairwiseConfig?: EvaluationComparisonPairwiseConfigV1;
  readonly deterministicSummary?: EvaluationComparisonDeterministicSummaryV1;
  readonly pairwiseSummary?: EvaluationComparisonPairwiseSummaryV1;
  readonly regressionAssessment?: EvaluationComparisonRegressionAssessmentV1;
  readonly promotion?: EvaluationComparisonPromotionV1;
  readonly costSummary?: EvaluationComparisonCostSummaryV1;
  readonly pairwiseRubricIdentity?: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly completedAt?: Date;
}

export class EvaluationComparison {
  private constructor(private readonly props: EvaluationComparisonProps) {}

  static create(input: {
    readonly id: EvaluationComparisonId;
    readonly workspaceId: WorkspaceId;
    readonly baselineEvaluationRunId: EvaluationRunId;
    readonly candidateEvaluationRunId: EvaluationRunId;
    readonly evaluationSuiteVersionId: EvaluationSuiteVersionId;
    readonly policySnapshot: EvaluationComparisonPolicyV1;
    readonly pairwiseConfig?: EvaluationComparisonPairwiseConfigV1;
    readonly pairwiseRubricIdentity?: string;
    readonly createdAt: Date;
  }): EvaluationComparison {
    return new EvaluationComparison({
      ...input,
      status: input.pairwiseConfig?.enabled === true ? "RUNNING" : "PENDING",
      updatedAt: input.createdAt,
    });
  }

  static restore(props: EvaluationComparisonProps): EvaluationComparison {
    if (!isEvaluationComparisonState(props.status)) {
      throw new Error(`Invalid comparison status '${props.status}'.`);
    }
    return new EvaluationComparison({ ...props });
  }

  get id(): EvaluationComparisonId {
    return this.props.id;
  }
  get workspaceId(): WorkspaceId {
    return this.props.workspaceId;
  }
  get baselineEvaluationRunId(): EvaluationRunId {
    return this.props.baselineEvaluationRunId;
  }
  get candidateEvaluationRunId(): EvaluationRunId {
    return this.props.candidateEvaluationRunId;
  }
  get evaluationSuiteVersionId(): EvaluationSuiteVersionId {
    return this.props.evaluationSuiteVersionId;
  }
  get status(): EvaluationComparisonState {
    return this.props.status;
  }
  get policySnapshot(): EvaluationComparisonPolicyV1 {
    return this.props.policySnapshot;
  }
  get pairwiseConfig(): EvaluationComparisonPairwiseConfigV1 | undefined {
    return this.props.pairwiseConfig;
  }
  get deterministicSummary():
    EvaluationComparisonDeterministicSummaryV1 | undefined {
    return this.props.deterministicSummary;
  }
  get pairwiseSummary(): EvaluationComparisonPairwiseSummaryV1 | undefined {
    return this.props.pairwiseSummary;
  }
  get regressionAssessment():
    EvaluationComparisonRegressionAssessmentV1 | undefined {
    return this.props.regressionAssessment;
  }
  get promotion(): EvaluationComparisonPromotionV1 | undefined {
    return this.props.promotion;
  }
  get costSummary(): EvaluationComparisonCostSummaryV1 | undefined {
    return this.props.costSummary;
  }
  get pairwiseRubricIdentity(): string | undefined {
    return this.props.pairwiseRubricIdentity;
  }
  get createdAt(): Date {
    return this.props.createdAt;
  }
  get updatedAt(): Date {
    return this.props.updatedAt;
  }
  get completedAt(): Date | undefined {
    return this.props.completedAt;
  }

  withUpdatedAssessment(input: {
    readonly deterministicSummary: EvaluationComparisonDeterministicSummaryV1;
    readonly pairwiseSummary?: EvaluationComparisonPairwiseSummaryV1;
    readonly regressionAssessment: EvaluationComparisonRegressionAssessmentV1;
    readonly promotion: EvaluationComparisonPromotionV1;
    readonly costSummary?: EvaluationComparisonCostSummaryV1;
    readonly status: EvaluationComparisonState;
    readonly updatedAt: Date;
  }): EvaluationComparison {
    return new EvaluationComparison({
      ...this.props,
      ...input,
      completedAt:
        input.status === "COMPLETED" || input.status === "FAILED"
          ? input.updatedAt
          : this.props.completedAt,
    });
  }
}
