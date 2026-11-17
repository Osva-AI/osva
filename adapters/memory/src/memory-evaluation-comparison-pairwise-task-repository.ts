import type {
  EvaluationCaseId,
  EvaluationComparisonId,
  EvaluationComparisonPairwiseJudgmentPosition,
  EvaluationComparisonPairwiseTaskId,
  WorkspaceId,
} from "@osva-ai/contracts";
import type { EvaluationComparisonPairwiseTask } from "@osva/domain";
import type {
  ClaimComparisonPairwiseTaskLeaseCommand,
  EvaluationComparisonPairwiseTaskRepository,
} from "@osva/domain";

export class MemoryEvaluationComparisonPairwiseTaskRepository implements EvaluationComparisonPairwiseTaskRepository {
  private readonly tasks = new Map<
    EvaluationComparisonPairwiseTaskId,
    EvaluationComparisonPairwiseTask
  >();

  private key(
    comparisonId: EvaluationComparisonId,
    evaluationCaseId: EvaluationCaseId,
    judgmentPosition: EvaluationComparisonPairwiseJudgmentPosition,
  ): string {
    return `${comparisonId}:${evaluationCaseId}:${judgmentPosition}`;
  }

  async savePairwiseTaskIfAbsent(
    task: EvaluationComparisonPairwiseTask,
  ): Promise<"created" | "existing"> {
    for (const existing of this.tasks.values()) {
      if (
        existing.comparisonId === task.comparisonId &&
        existing.evaluationCaseId === task.evaluationCaseId &&
        existing.judgmentPosition === task.judgmentPosition
      ) {
        return "existing";
      }
    }
    this.tasks.set(task.id, task);
    return "created";
  }

  async findPairwiseTask(
    comparisonId: EvaluationComparisonId,
    evaluationCaseId: EvaluationCaseId,
    judgmentPosition: EvaluationComparisonPairwiseJudgmentPosition,
  ): Promise<EvaluationComparisonPairwiseTask | null> {
    for (const task of this.tasks.values()) {
      if (
        task.comparisonId === comparisonId &&
        task.evaluationCaseId === evaluationCaseId &&
        task.judgmentPosition === judgmentPosition
      ) {
        return task;
      }
    }
    return null;
  }

  async findPairwiseTaskById(
    id: EvaluationComparisonPairwiseTaskId,
  ): Promise<EvaluationComparisonPairwiseTask | null> {
    return this.tasks.get(id) ?? null;
  }

  async listPairwiseTasksForRecovery(
    limit: number,
    now: Date,
  ): Promise<readonly EvaluationComparisonPairwiseTask[]> {
    void now;
    return [...this.tasks.values()]
      .filter((task) => task.status === "PENDING" || task.status === "RUNNING")
      .slice(0, limit);
  }

  async claimPairwiseTaskLease(
    command: ClaimComparisonPairwiseTaskLeaseCommand,
  ): Promise<EvaluationComparisonPairwiseTask | null> {
    const task = this.tasks.get(command.taskId);
    if (task === undefined || task.workspaceId !== command.workspaceId) {
      return null;
    }
    if (task.status === "SUCCEEDED" || task.status === "FAILED") {
      return null;
    }
    if (task.status === "RUNNING") {
      const leaseValid =
        task.leaseExpiresAt !== undefined &&
        task.leaseExpiresAt.getTime() > command.now.getTime();
      if (leaseValid) {
        return null;
      }
    }
    const claimed = task.withLeaseClaim({
      owner: command.owner,
      generation: command.generation,
      leaseExpiresAt: command.leaseExpiresAt,
      updatedAt: command.now,
    });
    this.tasks.set(task.id, claimed);
    return claimed;
  }

  async savePairwiseTaskTerminal(
    task: EvaluationComparisonPairwiseTask,
  ): Promise<boolean> {
    const current = this.tasks.get(task.id);
    if (current === undefined) {
      return false;
    }
    if (
      current.executionGeneration !== task.executionGeneration ||
      current.status !== "RUNNING"
    ) {
      return false;
    }
    this.tasks.set(task.id, task);
    return true;
  }

  async appendPairwiseInvocationAttempt(command: {
    readonly taskId: EvaluationComparisonPairwiseTaskId;
    readonly workspaceId: WorkspaceId;
    readonly executionGeneration: number;
    readonly attempt: Readonly<Record<string, unknown>>;
  }): Promise<boolean> {
    const task = this.tasks.get(command.taskId);
    if (
      task === undefined ||
      task.workspaceId !== command.workspaceId ||
      task.executionGeneration !== command.executionGeneration ||
      task.status !== "RUNNING"
    ) {
      return false;
    }
    this.tasks.set(
      task.id,
      task.withAppendedInvocationAttempt(command.attempt, task.updatedAt),
    );
    return true;
  }

  async countNonTerminalPairwiseTasksByComparison(
    comparisonId: EvaluationComparisonId,
  ): Promise<number> {
    let count = 0;
    for (const task of this.tasks.values()) {
      if (
        task.comparisonId === comparisonId &&
        (task.status === "PENDING" || task.status === "RUNNING")
      ) {
        count += 1;
      }
    }
    return count;
  }

  async listPairwiseTasksByComparison(
    workspaceId: WorkspaceId,
    comparisonId: EvaluationComparisonId,
  ): Promise<readonly EvaluationComparisonPairwiseTask[]> {
    return [...this.tasks.values()]
      .filter(
        (task) =>
          task.workspaceId === workspaceId &&
          task.comparisonId === comparisonId,
      )
      .sort((a, b) =>
        a.evaluationCaseId === b.evaluationCaseId
          ? a.judgmentPosition.localeCompare(b.judgmentPosition)
          : a.evaluationCaseId.localeCompare(b.evaluationCaseId),
      );
  }

  async listSucceededPairwiseTasksByComparison(
    comparisonId: EvaluationComparisonId,
  ): Promise<readonly EvaluationComparisonPairwiseTask[]> {
    return [...this.tasks.values()].filter(
      (task) =>
        task.comparisonId === comparisonId && task.status === "SUCCEEDED",
    );
  }
}
