import type {
  EvaluationCaseId,
  EvaluationJudgeTaskId,
  EvaluationJudgeTaskState,
  EvaluationRunId,
  RunAttemptId,
  RunId,
  WorkspaceId,
} from "@osva-ai/contracts";
import {
  DEFAULT_EVALUATION_JUDGE_TASK_MAX_ATTEMPTS,
  isEvaluationJudgeTaskState,
} from "@osva-ai/contracts";

export interface EvaluationJudgeTaskSnapshot {
  readonly evaluatorConfig: Readonly<Record<string, unknown>>;
  readonly rubricIdentity: string;
  readonly minPassingScore: number;
  readonly maxOutputTokens: number;
  readonly evaluationSuiteVersionId: string;
  readonly caseInput: unknown;
  readonly caseExpected?: unknown;
  readonly targetOutput?: unknown;
}

export interface EvaluationJudgeTaskTerminalResult {
  readonly verdict?: Readonly<Record<string, unknown>>;
  readonly judgeUsageAccounting?: Readonly<Record<string, unknown>>;
  readonly invocationAttempts?: readonly Readonly<Record<string, unknown>>[];
}

export interface EvaluationJudgeTaskProps {
  readonly id: EvaluationJudgeTaskId;
  readonly workspaceId: WorkspaceId;
  readonly evaluationRunId: EvaluationRunId;
  readonly evaluationCaseId: EvaluationCaseId;
  readonly runId: RunId;
  readonly runAttemptId: RunAttemptId;
  readonly snapshot: EvaluationJudgeTaskSnapshot;
  readonly status: EvaluationJudgeTaskState;
  readonly attemptCount: number;
  readonly maxAttempts: number;
  readonly executionOwner?: string;
  readonly executionGeneration: number;
  readonly leaseExpiresAt?: Date;
  readonly terminalResult?: EvaluationJudgeTaskTerminalResult;
  readonly errorCode?: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly completedAt?: Date;
}

export class EvaluationJudgeTask {
  private constructor(private readonly props: EvaluationJudgeTaskProps) {}

  static create(input: {
    readonly id: EvaluationJudgeTaskId;
    readonly workspaceId: WorkspaceId;
    readonly evaluationRunId: EvaluationRunId;
    readonly evaluationCaseId: EvaluationCaseId;
    readonly runId: RunId;
    readonly runAttemptId: RunAttemptId;
    readonly snapshot: EvaluationJudgeTaskSnapshot;
    readonly createdAt: Date;
    readonly maxAttempts?: number;
  }): EvaluationJudgeTask {
    return new EvaluationJudgeTask({
      id: input.id,
      workspaceId: input.workspaceId,
      evaluationRunId: input.evaluationRunId,
      evaluationCaseId: input.evaluationCaseId,
      runId: input.runId,
      runAttemptId: input.runAttemptId,
      snapshot: input.snapshot,
      status: "PENDING",
      attemptCount: 0,
      maxAttempts:
        input.maxAttempts ?? DEFAULT_EVALUATION_JUDGE_TASK_MAX_ATTEMPTS,
      executionGeneration: 0,
      createdAt: input.createdAt,
      updatedAt: input.createdAt,
    });
  }

  static restore(props: EvaluationJudgeTaskProps): EvaluationJudgeTask {
    if (!isEvaluationJudgeTaskState(props.status)) {
      throw new Error(
        `Invalid evaluation judge task status '${props.status}'.`,
      );
    }
    return new EvaluationJudgeTask({ ...props });
  }

  get id(): EvaluationJudgeTaskId {
    return this.props.id;
  }

  get workspaceId(): WorkspaceId {
    return this.props.workspaceId;
  }

  get evaluationRunId(): EvaluationRunId {
    return this.props.evaluationRunId;
  }

  get evaluationCaseId(): EvaluationCaseId {
    return this.props.evaluationCaseId;
  }

  get runId(): RunId {
    return this.props.runId;
  }

  get runAttemptId(): RunAttemptId {
    return this.props.runAttemptId;
  }

  get snapshot(): EvaluationJudgeTaskSnapshot {
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

  get terminalResult(): EvaluationJudgeTaskTerminalResult | undefined {
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
  }): EvaluationJudgeTask {
    return new EvaluationJudgeTask({
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
    readonly terminalResult: EvaluationJudgeTaskTerminalResult;
    readonly updatedAt: Date;
  }): EvaluationJudgeTask {
    return new EvaluationJudgeTask({
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
  }): EvaluationJudgeTask {
    return new EvaluationJudgeTask({
      ...this.props,
      status: "FAILED",
      executionOwner: undefined,
      leaseExpiresAt: undefined,
      errorCode: input.errorCode,
      updatedAt: input.updatedAt,
      completedAt: input.updatedAt,
    });
  }

  withPendingRetry(input: { readonly updatedAt: Date }): EvaluationJudgeTask {
    return new EvaluationJudgeTask({
      ...this.props,
      status: "PENDING",
      executionOwner: undefined,
      leaseExpiresAt: undefined,
      updatedAt: input.updatedAt,
    });
  }
}
