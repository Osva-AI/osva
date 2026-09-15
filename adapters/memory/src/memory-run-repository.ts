import type { RunAttemptId, RunId, RunStepId } from "@osva/contracts";
import type { Run, RunAttempt, RunRepository, RunStep } from "@osva/domain";

export class MemoryRunRepository implements RunRepository {
  private readonly runs = new Map<RunId, Run>();
  private readonly attempts = new Map<RunAttemptId, RunAttempt>();
  private readonly steps = new Map<RunStepId, RunStep>();

  async saveRun(run: Run): Promise<void> {
    this.runs.set(run.id, run);
  }

  async findRunById(id: RunId): Promise<Run | null> {
    return this.runs.get(id) ?? null;
  }

  async saveRunAttempt(attempt: RunAttempt): Promise<void> {
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

  /**
   * Test helper: snapshot of stored steps. Not part of RunRepository.
   */
  listRunSteps(): readonly RunStep[] {
    return Object.freeze([...this.steps.values()]);
  }
}
