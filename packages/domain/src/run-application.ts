import type { RunAttemptId, RunId } from "@osva/contracts";

import {
  DomainInvariantError,
  RunAttemptNotFoundError,
  RunNotFoundError,
} from "./errors.js";
import type {
  ListRunsQuery,
  ListRunsResult,
  RunRepository,
} from "./ports/run-repository.js";
import { MAX_RUN_LIST_LIMIT } from "./ports/run-repository.js";
import type { Run } from "./run.js";
import type { RunAttempt } from "./run-attempt.js";

export interface RunApplicationDependencies {
  readonly runs: RunRepository;
}

export interface GetRunAttemptCommand {
  readonly runId: RunId;
  readonly runAttemptId: RunAttemptId;
}

export class GetRun {
  constructor(private readonly deps: RunApplicationDependencies) {}

  async execute(runId: RunId): Promise<Run> {
    const run = await this.deps.runs.findRunById(runId);
    if (run === null) {
      throw new RunNotFoundError(runId);
    }

    return run;
  }
}

export class ListRuns {
  constructor(private readonly deps: RunApplicationDependencies) {}

  async execute(query: ListRunsQuery): Promise<ListRunsResult> {
    assertRunListLimit(query.limit);
    return this.deps.runs.listRuns(query);
  }
}

export class GetRunAttempt {
  constructor(private readonly deps: RunApplicationDependencies) {}

  async execute(command: GetRunAttemptCommand): Promise<RunAttempt> {
    const run = await this.deps.runs.findRunById(command.runId);
    if (run === null) {
      throw new RunNotFoundError(command.runId);
    }

    const attempt = await this.deps.runs.findRunAttemptById(
      command.runAttemptId,
    );
    if (attempt === null || attempt.runId !== command.runId) {
      throw new RunAttemptNotFoundError(command.runAttemptId);
    }

    return attempt;
  }
}

export class ListRunAttempts {
  constructor(private readonly deps: RunApplicationDependencies) {}

  async execute(runId: RunId): Promise<readonly RunAttempt[]> {
    const run = await this.deps.runs.findRunById(runId);
    if (run === null) {
      throw new RunNotFoundError(runId);
    }

    return this.deps.runs.listRunAttempts(runId);
  }
}

export interface RunApplication {
  readonly getRun: GetRun;
  readonly listRuns: ListRuns;
  readonly getRunAttempt: GetRunAttempt;
  readonly listRunAttempts: ListRunAttempts;
}

export function createRunApplication(
  deps: RunApplicationDependencies,
): RunApplication {
  return {
    getRun: new GetRun(deps),
    listRuns: new ListRuns(deps),
    getRunAttempt: new GetRunAttempt(deps),
    listRunAttempts: new ListRunAttempts(deps),
  };
}

function assertRunListLimit(limit: number): void {
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_RUN_LIST_LIMIT) {
    throw new DomainInvariantError(
      `Run list limit must be an integer between 1 and ${String(MAX_RUN_LIST_LIMIT)}.`,
    );
  }
}
