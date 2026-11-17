import type {
  EvaluationCaseId,
  EvaluationJudgeTaskId,
  EvaluationRunId,
} from "@osva-ai/contracts";
import { EvaluationJudgeTask } from "@osva/domain";
import type {
  ClaimEvaluationJudgeTaskLeaseCommand,
  EvaluationJudgeTaskRepository,
} from "@osva/domain";

export class MemoryEvaluationJudgeTaskRepository implements EvaluationJudgeTaskRepository {
  private readonly tasks = new Map<
    EvaluationJudgeTaskId,
    EvaluationJudgeTask
  >();

  async saveJudgeTaskIfAbsent(
    task: EvaluationJudgeTask,
  ): Promise<"created" | "existing"> {
    for (const existing of this.tasks.values()) {
      if (
        existing.evaluationRunId === task.evaluationRunId &&
        existing.evaluationCaseId === task.evaluationCaseId
      ) {
        return "existing";
      }
    }
    this.tasks.set(task.id, task);
    return "created";
  }

  async findJudgeTaskByRunAndCase(
    evaluationRunId: EvaluationRunId,
    evaluationCaseId: EvaluationCaseId,
  ): Promise<EvaluationJudgeTask | null> {
    for (const task of this.tasks.values()) {
      if (
        task.evaluationRunId === evaluationRunId &&
        task.evaluationCaseId === evaluationCaseId
      ) {
        return task;
      }
    }
    return null;
  }

  async findJudgeTaskById(
    id: EvaluationJudgeTaskId,
  ): Promise<EvaluationJudgeTask | null> {
    return this.tasks.get(id) ?? null;
  }

  async listJudgeTasksForRecovery(
    limit: number,
    now: Date,
  ): Promise<readonly EvaluationJudgeTask[]> {
    const candidates = [...this.tasks.values()].filter((task) => {
      if (task.status === "PENDING") {
        return true;
      }
      if (task.status === "RUNNING") {
        return (
          task.leaseExpiresAt === undefined ||
          task.leaseExpiresAt.getTime() < now.getTime()
        );
      }
      return false;
    });
    candidates.sort(
      (left, right) =>
        left.createdAt.getTime() - right.createdAt.getTime() ||
        left.id.localeCompare(right.id),
    );
    return candidates.slice(0, limit);
  }

  async claimJudgeTaskLease(
    command: ClaimEvaluationJudgeTaskLeaseCommand,
  ): Promise<EvaluationJudgeTask | null> {
    const current = this.tasks.get(command.taskId);
    if (current === undefined || current.workspaceId !== command.workspaceId) {
      return null;
    }
    if (
      current.status !== "PENDING" &&
      !(
        current.status === "RUNNING" &&
        current.leaseExpiresAt !== undefined &&
        current.leaseExpiresAt.getTime() < command.now.getTime()
      )
    ) {
      return null;
    }
    const claimed = current.withLeaseClaim({
      owner: command.owner,
      generation: command.generation,
      leaseExpiresAt: command.leaseExpiresAt,
      updatedAt: command.now,
    });
    this.tasks.set(claimed.id, claimed);
    return claimed;
  }

  async saveJudgeTaskTerminal(task: EvaluationJudgeTask): Promise<boolean> {
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

  async appendJudgeInvocationAttempt(command: {
    readonly taskId: EvaluationJudgeTaskId;
    readonly workspaceId: import("@osva-ai/contracts").WorkspaceId;
    readonly executionGeneration: number;
    readonly attempt: Readonly<Record<string, unknown>>;
  }): Promise<boolean> {
    const current = this.tasks.get(command.taskId);
    if (
      current === undefined ||
      current.workspaceId !== command.workspaceId ||
      current.executionGeneration !== command.executionGeneration ||
      current.status !== "RUNNING"
    ) {
      return false;
    }
    const prior = current.terminalResult?.invocationAttempts ?? [];
    const terminalResult = {
      ...current.terminalResult,
      invocationAttempts: [...prior, command.attempt],
    };
    const updated = EvaluationJudgeTask.restore({
      id: current.id,
      workspaceId: current.workspaceId,
      evaluationRunId: current.evaluationRunId,
      evaluationCaseId: current.evaluationCaseId,
      runId: current.runId,
      runAttemptId: current.runAttemptId,
      snapshot: current.snapshot,
      status: current.status,
      attemptCount: current.attemptCount,
      maxAttempts: current.maxAttempts,
      executionOwner: current.executionOwner,
      executionGeneration: current.executionGeneration,
      leaseExpiresAt: current.leaseExpiresAt,
      terminalResult,
      errorCode: current.errorCode,
      createdAt: current.createdAt,
      updatedAt: new Date(),
      completedAt: current.completedAt,
    });
    this.tasks.set(updated.id, updated);
    return true;
  }

  async listTerminalJudgeTasksMissingCaseResult(
    limit: number,
  ): Promise<readonly EvaluationJudgeTask[]> {
    void limit;
    return [];
  }

  async countNonTerminalJudgeTasksByRun(
    evaluationRunId: EvaluationRunId,
  ): Promise<number> {
    let count = 0;
    for (const task of this.tasks.values()) {
      if (
        task.evaluationRunId === evaluationRunId &&
        (task.status === "PENDING" || task.status === "RUNNING")
      ) {
        count += 1;
      }
    }
    return count;
  }
}
