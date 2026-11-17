import type {
  EvaluationCaseId,
  EvaluationComparisonId,
  EvaluationComparisonPairwiseJudgmentPosition,
  EvaluationComparisonPairwiseTaskId,
  EvaluationJudgeTaskState,
  WorkspaceId,
} from "@osva-ai/contracts";
import { DEFAULT_EVALUATION_JUDGE_TASK_MAX_ATTEMPTS } from "@osva-ai/contracts";

export interface EvaluationComparisonPairwiseTaskSnapshot {
  readonly rubricIdentity: string;
  readonly modelProfileVersionId: string;
  readonly maxOutputTokens: number;
  readonly caseInput: unknown;
  readonly caseExpected?: unknown;
  readonly baselineAnswer: unknown;
  readonly candidateAnswer: unknown;
  readonly rubric: string;
  readonly instructions?: string;
  readonly judgmentPosition: EvaluationComparisonPairwiseJudgmentPosition;
}

export interface EvaluationComparisonPairwiseTaskTerminalResult {
  readonly verdict?: Readonly<Record<string, unknown>>;
  readonly judgeUsageAccounting?: Readonly<Record<string, unknown>>;
  readonly invocationAttempts?: readonly Readonly<Record<string, unknown>>[];
}

export class EvaluationComparisonPairwiseTask {
  constructor(
    private readonly props: {
      readonly id: EvaluationComparisonPairwiseTaskId;
      readonly workspaceId: WorkspaceId;
      readonly comparisonId: EvaluationComparisonId;
      readonly evaluationCaseId: EvaluationCaseId;
      readonly judgmentPosition: EvaluationComparisonPairwiseJudgmentPosition;
      readonly snapshot: EvaluationComparisonPairwiseTaskSnapshot;
      readonly status: EvaluationJudgeTaskState;
      readonly attemptCount: number;
      readonly maxAttempts: number;
      readonly executionOwner?: string;
      readonly executionGeneration: number;
      readonly leaseExpiresAt?: Date;
      readonly terminalResult?: EvaluationComparisonPairwiseTaskTerminalResult;
      readonly errorCode?: string;
      readonly createdAt: Date;
      readonly updatedAt: Date;
      readonly completedAt?: Date;
    },
  ) {}

  static create(input: {
    readonly id: EvaluationComparisonPairwiseTaskId;
    readonly workspaceId: WorkspaceId;
    readonly comparisonId: EvaluationComparisonId;
    readonly evaluationCaseId: EvaluationCaseId;
    readonly judgmentPosition: EvaluationComparisonPairwiseJudgmentPosition;
    readonly snapshot: EvaluationComparisonPairwiseTaskSnapshot;
    readonly createdAt: Date;
    readonly maxAttempts?: number;
  }): EvaluationComparisonPairwiseTask {
    return new EvaluationComparisonPairwiseTask({
      ...input,
      status: "PENDING",
      attemptCount: 0,
      maxAttempts:
        input.maxAttempts ?? DEFAULT_EVALUATION_JUDGE_TASK_MAX_ATTEMPTS,
      executionGeneration: 0,
      updatedAt: input.createdAt,
    });
  }

  get id(): EvaluationComparisonPairwiseTaskId {
    return this.props.id;
  }
  get workspaceId(): WorkspaceId {
    return this.props.workspaceId;
  }
  get comparisonId(): EvaluationComparisonId {
    return this.props.comparisonId;
  }
  get evaluationCaseId(): EvaluationCaseId {
    return this.props.evaluationCaseId;
  }
  get judgmentPosition(): EvaluationComparisonPairwiseJudgmentPosition {
    return this.props.judgmentPosition;
  }
  get snapshot(): EvaluationComparisonPairwiseTaskSnapshot {
    return this.props.snapshot;
  }
  get status(): EvaluationJudgeTaskState {
    return this.props.status;
  }
  get attemptCount(): number {
    return this.props.attemptCount;
  }
  get maxAttempts(): number {
    return this.props.maxAttempts;
  }
  get executionOwner(): string | undefined {
    return this.props.executionOwner;
  }
  get executionGeneration(): number {
    return this.props.executionGeneration;
  }
  get leaseExpiresAt(): Date | undefined {
    return this.props.leaseExpiresAt;
  }
  get terminalResult():
    EvaluationComparisonPairwiseTaskTerminalResult | undefined {
    return this.props.terminalResult;
  }
  get errorCode(): string | undefined {
    return this.props.errorCode;
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

  withLeaseClaim(input: {
    readonly owner: string;
    readonly generation: number;
    readonly leaseExpiresAt: Date;
    readonly updatedAt: Date;
  }): EvaluationComparisonPairwiseTask {
    return new EvaluationComparisonPairwiseTask({
      ...this.props,
      status: "RUNNING",
      attemptCount: this.props.attemptCount + 1,
      executionOwner: input.owner,
      executionGeneration: input.generation,
      leaseExpiresAt: input.leaseExpiresAt,
      updatedAt: input.updatedAt,
      errorCode: undefined,
    });
  }

  withSucceeded(input: {
    readonly terminalResult: EvaluationComparisonPairwiseTaskTerminalResult;
    readonly updatedAt: Date;
  }): EvaluationComparisonPairwiseTask {
    return new EvaluationComparisonPairwiseTask({
      ...this.props,
      status: "SUCCEEDED",
      executionOwner: undefined,
      leaseExpiresAt: undefined,
      terminalResult: input.terminalResult,
      updatedAt: input.updatedAt,
      completedAt: input.updatedAt,
    });
  }

  withFailed(input: {
    readonly errorCode: string;
    readonly updatedAt: Date;
    readonly terminalResult?: EvaluationComparisonPairwiseTaskTerminalResult;
  }): EvaluationComparisonPairwiseTask {
    return new EvaluationComparisonPairwiseTask({
      ...this.props,
      status: "FAILED",
      executionOwner: undefined,
      leaseExpiresAt: undefined,
      errorCode: input.errorCode,
      terminalResult: input.terminalResult ?? this.props.terminalResult,
      updatedAt: input.updatedAt,
      completedAt: input.updatedAt,
    });
  }

  withPendingRetry(input: {
    readonly updatedAt: Date;
  }): EvaluationComparisonPairwiseTask {
    return new EvaluationComparisonPairwiseTask({
      ...this.props,
      status: "PENDING",
      executionOwner: undefined,
      leaseExpiresAt: undefined,
      updatedAt: input.updatedAt,
    });
  }

  withAppendedInvocationAttempt(
    attempt: Readonly<Record<string, unknown>>,
    updatedAt: Date,
  ): EvaluationComparisonPairwiseTask {
    const prior = this.props.terminalResult?.invocationAttempts ?? [];
    return new EvaluationComparisonPairwiseTask({
      ...this.props,
      terminalResult: {
        ...(this.props.terminalResult ?? {}),
        invocationAttempts: [...prior, attempt],
      },
      updatedAt,
    });
  }
}
