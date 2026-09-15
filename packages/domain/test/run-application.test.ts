import type { RunAttemptId, RunId } from "@osva/contracts";
import { describe, expect, it } from "vitest";

import {
  DomainInvariantError,
  Run,
  RunAttempt,
  RunAttemptNotFoundError,
  RunNotFoundError,
  createRunApplication,
  type ListRunsQuery,
  type ListRunsResult,
  type RunRepository,
} from "../src/index.js";
import {
  NOW,
  RUN_INPUT,
  agentId,
  createBindings,
  runAttemptId,
  runId,
  workspaceId,
} from "./fixtures.js";

class FakeRunRepository implements RunRepository {
  constructor(
    private readonly runs = new Map<RunId, Run>(),
    private readonly attempts = new Map<RunAttemptId, RunAttempt>(),
  ) {}

  async createRunWithInitialAttempt(): Promise<void> {
    throw new Error("not used");
  }

  async saveRun(): Promise<void> {
    throw new Error("not used");
  }

  async findRunById(id: RunId): Promise<Run | null> {
    return this.runs.get(id) ?? null;
  }

  async listRuns(query: ListRunsQuery): Promise<ListRunsResult> {
    return {
      runs: [...this.runs.values()].slice(0, query.limit),
    };
  }

  async saveRunAttempt(): Promise<void> {
    throw new Error("not used");
  }

  async findRunAttemptById(id: RunAttemptId): Promise<RunAttempt | null> {
    return this.attempts.get(id) ?? null;
  }

  async listRunAttempts(runId: RunId): Promise<readonly RunAttempt[]> {
    return [...this.attempts.values()].filter(
      (attempt) => attempt.runId === runId,
    );
  }

  async saveRunStep(): Promise<void> {
    throw new Error("not used");
  }

  async transitionRun(): Promise<Run> {
    throw new Error("not used");
  }

  async transitionRunAttempt(): Promise<RunAttempt> {
    throw new Error("not used");
  }

  async transitionRunAndAttempt(): Promise<{
    run: Run;
    runAttempt: RunAttempt;
  }> {
    throw new Error("not used");
  }

  seed(run: Run, attempt?: RunAttempt): void {
    this.runs.set(run.id, run);
    if (attempt) {
      this.attempts.set(attempt.id, attempt);
    }
  }
}

describe("Run application", () => {
  it("returns a persisted Run and rejects a missing Run", async () => {
    const repository = new FakeRunRepository();
    const run = Run.create({
      id: runId,
      workspaceId,
      agentId,
      effectiveBindings: createBindings(),
      input: RUN_INPUT,
      createdAt: NOW,
    });
    repository.seed(run);
    const application = createRunApplication({ runs: repository });

    expect(await application.getRun.execute(runId)).toEqual(run);
    await expect(
      application.getRun.execute("missing" as RunId),
    ).rejects.toBeInstanceOf(RunNotFoundError);
  });

  it("rejects an invalid list limit", async () => {
    const application = createRunApplication({
      runs: new FakeRunRepository(),
    });

    await expect(
      application.listRuns.execute({ limit: 0 }),
    ).rejects.toBeInstanceOf(DomainInvariantError);
    await expect(
      application.listRuns.execute({ limit: 101 }),
    ).rejects.toBeInstanceOf(DomainInvariantError);
  });

  it("lists attempts only after confirming the Run exists", async () => {
    const repository = new FakeRunRepository();
    const application = createRunApplication({ runs: repository });

    await expect(
      application.listRunAttempts.execute(runId),
    ).rejects.toBeInstanceOf(RunNotFoundError);

    const run = Run.create({
      id: runId,
      workspaceId,
      agentId,
      effectiveBindings: createBindings(),
      input: RUN_INPUT,
      createdAt: NOW,
    });
    const attempt = RunAttempt.createFirst({
      id: runAttemptId,
      runId,
      createdAt: NOW,
    });
    repository.seed(run, attempt);

    expect(await application.listRunAttempts.execute(runId)).toEqual([attempt]);
  });

  it("hides a RunAttempt that belongs to another Run", async () => {
    const repository = new FakeRunRepository();
    const run = Run.create({
      id: runId,
      workspaceId,
      agentId,
      effectiveBindings: createBindings(),
      input: RUN_INPUT,
      createdAt: NOW,
    });
    const attempt = RunAttempt.createFirst({
      id: runAttemptId,
      runId: "other-run" as RunId,
      createdAt: NOW,
    });
    repository.seed(run, attempt);
    const application = createRunApplication({ runs: repository });

    await expect(
      application.getRunAttempt.execute({
        runId,
        runAttemptId,
      }),
    ).rejects.toBeInstanceOf(RunAttemptNotFoundError);
  });
});
