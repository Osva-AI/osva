import type {
  RunAttemptId,
  RunAttemptState,
  RunId,
  RunState,
  RunStepId,
  WorkspaceId,
} from "@osva/contracts";
import {
  DomainInvariantError,
  LifecycleConflictError,
  Run,
  RunAttempt,
  RunAttemptNotFoundError,
  RunNotFoundError,
  RunStepNotFoundError,
  assertLegalRunAttemptTransition,
  assertLegalRunTransition,
} from "@osva/domain";
import type {
  FinalizeRunStepProps,
  ListRunStepsQuery,
  ListRunStepsResult,
  ListRunsQuery,
  ListRunsResult,
  RunAttemptUsageSummary,
  RunLifecycleTransitionResult,
  RunListCursor,
  RunRepository,
  RunStep,
  RunStepListCursor,
} from "@osva/domain";

export class MemoryRunRepository implements RunRepository {
  private readonly runs = new Map<RunId, Run>();
  private readonly attempts = new Map<RunAttemptId, RunAttempt>();
  private readonly steps = new Map<RunStepId, RunStep>();
  private readonly runsByWorkspaceIdempotencyKey = new Map<string, RunId>();

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
    indexRunIdempotencyKey(this.runsByWorkspaceIdempotencyKey, run);
  }

  async saveRun(run: Run): Promise<void> {
    if (this.runs.has(run.id)) {
      throw new DomainInvariantError(
        `A Run with id '${run.id}' already exists.`,
      );
    }

    this.runs.set(run.id, run);
    indexRunIdempotencyKey(this.runsByWorkspaceIdempotencyKey, run);
  }

  async findRunById(id: RunId): Promise<Run | null> {
    return this.runs.get(id) ?? null;
  }

  async findRunByWorkspaceIdempotencyKey(
    workspaceId: WorkspaceId,
    idempotencyKey: string,
  ): Promise<Run | null> {
    const runId = this.runsByWorkspaceIdempotencyKey.get(
      workspaceIdempotencyKey(workspaceId, idempotencyKey),
    );
    if (runId === undefined) {
      return null;
    }

    return this.runs.get(runId) ?? null;
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

  async insertRunningRunStep(step: RunStep): Promise<void> {
    if (step.status !== "RUNNING") {
      throw new DomainInvariantError(
        "insertRunningRunStep requires a RUNNING RunStep.",
      );
    }

    if (this.steps.has(step.id)) {
      throw new DomainInvariantError(
        `A RunStep with id '${step.id}' already exists.`,
      );
    }

    this.steps.set(step.id, step);
  }

  async finalizeRunStep(
    runStepId: RunStepId,
    finalize: FinalizeRunStepProps,
  ): Promise<RunStep> {
    const existing = this.steps.get(runStepId);
    if (existing === undefined) {
      throw new RunStepNotFoundError(runStepId);
    }

    if (existing.status !== "RUNNING") {
      throw new LifecycleConflictError("runStep", runStepId, "RUNNING");
    }

    const finalized = existing.finalize(finalize);
    this.steps.set(runStepId, finalized);
    return finalized;
  }

  async findRunStepById(id: RunStepId): Promise<RunStep | null> {
    return this.steps.get(id) ?? null;
  }

  async listRunSteps(query: ListRunStepsQuery): Promise<ListRunStepsResult> {
    const filtered = [...this.steps.values()].filter((step) => {
      if (step.runAttemptId !== query.runAttemptId) {
        return false;
      }

      if (
        query.cursor !== undefined &&
        !isAfterRunStepCursor(step, query.cursor)
      ) {
        return false;
      }

      return true;
    });

    filtered.sort(compareRunStepsStartedAtIdAsc);

    const page = filtered.slice(0, query.limit);
    const hasMore = filtered.length > query.limit;
    const last = page[page.length - 1];

    return {
      steps: page,
      nextCursor:
        hasMore && last !== undefined
          ? { startedAt: last.startedAt, id: last.id }
          : undefined,
    };
  }

  async aggregateRunAttemptUsage(
    runAttemptId: RunAttemptId,
  ): Promise<RunAttemptUsageSummary> {
    const succeeded = [...this.steps.values()].filter(
      (step) =>
        step.runAttemptId === runAttemptId && step.status === "SUCCEEDED",
    );

    let modelCalls = 0;
    let toolCalls = 0;
    let inputTokens = 0;
    let outputTokens = 0;
    let totalTokens = 0;
    let cachedInputTokens = 0;
    let estimatedCostUsdMicros = 0;
    let pricedModelCalls = 0;
    let unpricedModelCalls = 0;
    let hasPricedCost = false;

    for (const step of succeeded) {
      if (step.kind === "TOOL") {
        toolCalls += 1;
        continue;
      }

      modelCalls += 1;
      inputTokens += step.inputTokens ?? 0;
      outputTokens += step.outputTokens ?? 0;
      totalTokens += step.totalTokens ?? 0;
      cachedInputTokens += step.cachedInputTokens ?? 0;

      if (
        step.estimatedCostUsdMicros === null ||
        step.estimatedCostUsdMicros === undefined
      ) {
        unpricedModelCalls += 1;
      } else {
        pricedModelCalls += 1;
        hasPricedCost = true;
        estimatedCostUsdMicros += step.estimatedCostUsdMicros;
      }
    }

    return {
      modelCalls,
      toolCalls,
      inputTokens,
      outputTokens,
      totalTokens,
      cachedInputTokens,
      estimatedCostUsdMicros: hasPricedCost ? estimatedCostUsdMicros : null,
      pricedModelCalls,
      unpricedModelCalls,
    };
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
  snapshotRunSteps(): readonly RunStep[] {
    return Object.freeze([...this.steps.values()]);
  }
}

function compareRunStepsStartedAtIdAsc(left: RunStep, right: RunStep): number {
  const startedDelta = left.startedAt.getTime() - right.startedAt.getTime();
  if (startedDelta !== 0) {
    return startedDelta;
  }

  if (left.id < right.id) {
    return -1;
  }

  if (left.id > right.id) {
    return 1;
  }

  return 0;
}

function isAfterRunStepCursor(
  step: RunStep,
  cursor: RunStepListCursor,
): boolean {
  if (step.startedAt.getTime() > cursor.startedAt.getTime()) {
    return true;
  }

  return (
    step.startedAt.getTime() === cursor.startedAt.getTime() &&
    step.id > cursor.id
  );
}

function workspaceIdempotencyKey(
  workspaceId: WorkspaceId,
  idempotencyKey: string,
): string {
  return `${workspaceId}:${idempotencyKey}`;
}

function indexRunIdempotencyKey(index: Map<string, RunId>, run: Run): void {
  if (run.idempotencyKey === undefined) {
    return;
  }

  index.set(
    workspaceIdempotencyKey(run.workspaceId, run.idempotencyKey),
    run.id,
  );
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
