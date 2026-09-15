import type {
  RunAttemptId,
  RunAttemptState,
  RunId,
  RunState,
  RunStepId,
} from "@osva/contracts";
import {
  DomainInvariantError,
  LifecycleConflictError,
  Run,
  RunAttempt,
  RunAttemptNotFoundError,
  RunNotFoundError,
  assertLegalRunAttemptTransition,
  assertLegalRunTransition,
} from "@osva/domain";
import type {
  ListRunsQuery,
  ListRunsResult,
  RunLifecycleTransitionResult,
  RunListCursor,
  RunRepository,
  RunStep,
} from "@osva/domain";

export class MemoryRunRepository implements RunRepository {
  private readonly runs = new Map<RunId, Run>();
  private readonly attempts = new Map<RunAttemptId, RunAttempt>();
  private readonly steps = new Map<RunStepId, RunStep>();

  async createRunWithInitialAttempt(
    run: Run,
    attempt: RunAttempt,
  ): Promise<void> {
    if (attempt.runId !== run.id) {
      throw new DomainInvariantError(
        "Initial RunAttempt.runId must match the created Run.id.",
      );
    }

    if (this.runs.has(run.id)) {
      throw new DomainInvariantError(
        `A Run with id '${run.id}' already exists.`,
      );
    }

    if (this.attempts.has(attempt.id)) {
      throw new DomainInvariantError(
        `A RunAttempt with id '${attempt.id}' already exists.`,
      );
    }

    this.runs.set(run.id, run);
    this.attempts.set(attempt.id, attempt);
  }

  async saveRun(run: Run): Promise<void> {
    if (this.runs.has(run.id)) {
      throw new DomainInvariantError(
        `A Run with id '${run.id}' already exists.`,
      );
    }

    this.runs.set(run.id, run);
  }

  async findRunById(id: RunId): Promise<Run | null> {
    return this.runs.get(id) ?? null;
  }

  async listRuns(query: ListRunsQuery): Promise<ListRunsResult> {
    const filtered = [...this.runs.values()].filter((run) => {
      if (query.agentId !== undefined && run.agentId !== query.agentId) {
        return false;
      }

      if (
        query.agentVersionId !== undefined &&
        run.effectiveBindings.agentVersionId !== query.agentVersionId
      ) {
        return false;
      }

      if (query.status !== undefined && run.status !== query.status) {
        return false;
      }

      if (query.cursor !== undefined && !isAfterRunCursor(run, query.cursor)) {
        return false;
      }

      return true;
    });

    filtered.sort(compareRunsCreatedAtIdDesc);

    const page = filtered.slice(0, query.limit);
    const hasMore = filtered.length > query.limit;
    const last = page[page.length - 1];

    return {
      runs: page,
      nextCursor:
        hasMore && last !== undefined
          ? { createdAt: last.createdAt, id: last.id }
          : undefined,
    };
  }

  async saveRunAttempt(attempt: RunAttempt): Promise<void> {
    if (this.attempts.has(attempt.id)) {
      throw new DomainInvariantError(
        `A RunAttempt with id '${attempt.id}' already exists.`,
      );
    }

    this.attempts.set(attempt.id, attempt);
  }

  async findRunAttemptById(id: RunAttemptId): Promise<RunAttempt | null> {
    return this.attempts.get(id) ?? null;
  }

  async listRunAttempts(runId: RunId): Promise<readonly RunAttempt[]> {
    return [...this.attempts.values()]
      .filter((attempt) => attempt.runId === runId)
      .sort((left, right) => left.sequence - right.sequence);
  }

  async saveRunStep(step: RunStep): Promise<void> {
    this.steps.set(step.id, step);
  }

  async transitionRun(expectedStatus: RunState, next: Run): Promise<Run> {
    assertLegalRunTransition(expectedStatus, next.status);

    const current = this.runs.get(next.id);
    if (current === undefined) {
      throw new RunNotFoundError(next.id);
    }

    if (current.status !== expectedStatus) {
      throw new LifecycleConflictError("run", next.id, expectedStatus);
    }

    const persisted = applyRunLifecycle(current, next);
    this.runs.set(persisted.id, persisted);
    return persisted;
  }

  async transitionRunAttempt(
    expectedStatus: RunAttemptState,
    next: RunAttempt,
  ): Promise<RunAttempt> {
    assertLegalRunAttemptTransition(expectedStatus, next.status);

    const current = this.attempts.get(next.id);
    if (current === undefined) {
      throw new RunAttemptNotFoundError(next.id);
    }

    if (current.status !== expectedStatus) {
      throw new LifecycleConflictError("runAttempt", next.id, expectedStatus);
    }

    const persisted = applyRunAttemptLifecycle(current, next);
    this.attempts.set(persisted.id, persisted);
    return persisted;
  }

  async transitionRunAndAttempt(
    expectedRunStatus: RunState,
    nextRun: Run,
    expectedAttemptStatus: RunAttemptState,
    nextAttempt: RunAttempt,
  ): Promise<RunLifecycleTransitionResult> {
    if (nextAttempt.runId !== nextRun.id) {
      throw new DomainInvariantError(
        "Paired RunAttempt.runId must match the Run.id.",
      );
    }

    const previousAttempt = this.attempts.get(nextAttempt.id);
    const runAttempt = await this.transitionRunAttempt(
      expectedAttemptStatus,
      nextAttempt,
    );

    try {
      const run = await this.transitionRun(expectedRunStatus, nextRun);
      return { run, runAttempt };
    } catch (error) {
      if (previousAttempt !== undefined) {
        this.attempts.set(previousAttempt.id, previousAttempt);
      } else {
        this.attempts.delete(nextAttempt.id);
      }
      throw error;
    }
  }

  /**
   * Test helper: overwrite a stored Run snapshot without lifecycle rules.
   * Not part of RunRepository.
   */
  replaceRun(run: Run): void {
    this.runs.set(run.id, run);
  }

  /**
   * Test helper: overwrite a stored RunAttempt snapshot without lifecycle rules.
   * Not part of RunRepository.
   */
  replaceRunAttempt(attempt: RunAttempt): void {
    this.attempts.set(attempt.id, attempt);
  }

  /**
   * Test helper: snapshot of stored steps. Not part of RunRepository.
   */
  listRunSteps(): readonly RunStep[] {
    return Object.freeze([...this.steps.values()]);
  }
}

function compareRunsCreatedAtIdDesc(left: Run, right: Run): number {
  const createdDelta = right.createdAt.getTime() - left.createdAt.getTime();
  if (createdDelta !== 0) {
    return createdDelta;
  }

  if (right.id < left.id) {
    return -1;
  }

  if (right.id > left.id) {
    return 1;
  }

  return 0;
}

function isAfterRunCursor(run: Run, cursor: RunListCursor): boolean {
  if (run.createdAt.getTime() < cursor.createdAt.getTime()) {
    return true;
  }

  return (
    run.createdAt.getTime() === cursor.createdAt.getTime() && run.id < cursor.id
  );
}

function applyRunLifecycle(current: Run, next: Run): Run {
  return Run.rehydrate({
    id: current.id,
    workspaceId: current.workspaceId,
    agentId: current.agentId,
    status: next.status,
    effectiveBindings: current.effectiveBindings,
    input: current.input,
    createdAt: current.createdAt,
    updatedAt: next.updatedAt,
    idempotencyKey: current.idempotencyKey,
  });
}

function applyRunAttemptLifecycle(
  current: RunAttempt,
  next: RunAttempt,
): RunAttempt {
  return RunAttempt.rehydrate({
    id: current.id,
    runId: current.runId,
    sequence: current.sequence,
    status: next.status,
    createdAt: current.createdAt,
    startedAt: next.startedAt,
    completedAt: next.completedAt,
    error: next.error,
    output: next.output,
    infrastructureMetadata: next.infrastructureMetadata,
  });
}
