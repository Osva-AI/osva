import type { RunAttemptId, RunId } from "@osva/contracts";
import { AUTHORIZATION_ACTIONS } from "@osva/contracts";

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
import {
  controlPlaneWorkspaceId,
  requireControlPlaneAuthorization,
  type ControlPlaneScope,
} from "./control-plane.js";
import { CONTROL_PLANE_RESOURCE_KINDS } from "./control-plane-resource-kinds.js";

const RUN_RESOURCE = { kind: CONTROL_PLANE_RESOURCE_KINDS.run };

export interface RunApplicationDependencies {
  readonly runs: RunRepository;
}

export interface GetRunAttemptCommand {
  readonly runId: RunId;
  readonly runAttemptId: RunAttemptId;
}

export class GetRun {
  constructor(private readonly deps: RunApplicationDependencies) {}

  async execute(scope: ControlPlaneScope, runId: RunId): Promise<Run> {
    requireControlPlaneAuthorization(
      scope,
      AUTHORIZATION_ACTIONS.READ,
      RUN_RESOURCE,
    );
    const run = await this.deps.runs.findRunByWorkspaceAndId(
      controlPlaneWorkspaceId(scope),
      runId,
    );
    if (run === null) {
      throw new RunNotFoundError(runId);
    }

    return run;
  }
}

export class ListRuns {
  constructor(private readonly deps: RunApplicationDependencies) {}

  async execute(
    scope: ControlPlaneScope,
    query: Omit<ListRunsQuery, "workspaceId">,
  ): Promise<ListRunsResult> {
    requireControlPlaneAuthorization(
      scope,
      AUTHORIZATION_ACTIONS.READ,
      RUN_RESOURCE,
    );
    const workspaceId = controlPlaneWorkspaceId(scope);
    assertRunListLimit(query.limit);
    return this.deps.runs.listRuns({
      ...query,
      workspaceId,
    });
  }
}

export class GetRunAttempt {
  constructor(private readonly deps: RunApplicationDependencies) {}

  async execute(
    scope: ControlPlaneScope,
    command: GetRunAttemptCommand,
  ): Promise<RunAttempt> {
    requireControlPlaneAuthorization(
      scope,
      AUTHORIZATION_ACTIONS.READ,
      RUN_RESOURCE,
    );
    const workspaceId = controlPlaneWorkspaceId(scope);
    const run = await this.deps.runs.findRunByWorkspaceAndId(
      workspaceId,
      command.runId,
    );
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

  async execute(
    scope: ControlPlaneScope,
    runId: RunId,
  ): Promise<readonly RunAttempt[]> {
    requireControlPlaneAuthorization(
      scope,
      AUTHORIZATION_ACTIONS.READ,
      RUN_RESOURCE,
    );
    const run = await this.deps.runs.findRunByWorkspaceAndId(
      controlPlaneWorkspaceId(scope),
      runId,
    );
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
