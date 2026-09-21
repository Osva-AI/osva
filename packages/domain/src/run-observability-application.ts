import type {
  RunAttemptId,
  RunId,
  RunStepId,
  WorkspaceId,
} from "@osva/contracts";
import { AUTHORIZATION_ACTIONS } from "@osva/contracts";

import {
  DomainInvariantError,
  RunAttemptNotFoundError,
  RunNotFoundError,
  RunStepNotFoundError,
} from "./errors.js";
import type {
  ListRunStepsQuery,
  ListRunStepsResult,
  RunAttemptUsageSummary,
  RunRepository,
} from "./ports/run-repository.js";
import {
  DEFAULT_RUN_STEP_LIST_LIMIT,
  MAX_RUN_STEP_LIST_LIMIT,
} from "./ports/run-repository.js";
import type { RunStep } from "./run-step.js";
import {
  controlPlaneWorkspaceId,
  requireControlPlaneAuthorization,
  type ControlPlaneScope,
} from "./control-plane.js";
import { CONTROL_PLANE_RESOURCE_KINDS } from "./control-plane-resource-kinds.js";

const RUN_RESOURCE = { kind: CONTROL_PLANE_RESOURCE_KINDS.run };

export interface RunObservabilityApplicationDependencies {
  readonly runs: RunRepository;
}

export interface GetRunStepCommand {
  readonly runId: RunId;
  readonly runAttemptId: RunAttemptId;
  readonly runStepId: RunStepId;
}

export class ListRunSteps {
  constructor(private readonly deps: RunObservabilityApplicationDependencies) {}

  async execute(
    scope: ControlPlaneScope,
    runId: RunId,
    runAttemptId: RunAttemptId,
    query: Omit<ListRunStepsQuery, "runAttemptId">,
  ): Promise<ListRunStepsResult> {
    requireControlPlaneAuthorization(
      scope,
      AUTHORIZATION_ACTIONS.READ,
      RUN_RESOURCE,
    );
    await assertRunAttemptOwnership(
      this.deps.runs,
      controlPlaneWorkspaceId(scope),
      runId,
      runAttemptId,
    );
    assertRunStepListLimit(query.limit);

    return this.deps.runs.listRunSteps({
      runAttemptId,
      limit: query.limit,
      cursor: query.cursor,
    });
  }
}

export class GetRunStep {
  constructor(private readonly deps: RunObservabilityApplicationDependencies) {}

  async execute(
    scope: ControlPlaneScope,
    command: GetRunStepCommand,
  ): Promise<RunStep> {
    requireControlPlaneAuthorization(
      scope,
      AUTHORIZATION_ACTIONS.READ,
      RUN_RESOURCE,
    );
    await assertRunAttemptOwnership(
      this.deps.runs,
      controlPlaneWorkspaceId(scope),
      command.runId,
      command.runAttemptId,
    );

    const step = await this.deps.runs.findRunStepById(command.runStepId);
    if (
      step === null ||
      step.runId !== command.runId ||
      step.runAttemptId !== command.runAttemptId
    ) {
      throw new RunStepNotFoundError(command.runStepId);
    }

    return step;
  }
}

export class GetRunAttemptUsage {
  constructor(private readonly deps: RunObservabilityApplicationDependencies) {}

  async execute(
    scope: ControlPlaneScope,
    runId: RunId,
    runAttemptId: RunAttemptId,
  ): Promise<RunAttemptUsageSummary> {
    requireControlPlaneAuthorization(
      scope,
      AUTHORIZATION_ACTIONS.READ,
      RUN_RESOURCE,
    );
    await assertRunAttemptOwnership(
      this.deps.runs,
      controlPlaneWorkspaceId(scope),
      runId,
      runAttemptId,
    );
    return this.deps.runs.aggregateRunAttemptUsage(runAttemptId);
  }
}

export interface RunObservabilityApplication {
  readonly listRunSteps: ListRunSteps;
  readonly getRunStep: GetRunStep;
  readonly getRunAttemptUsage: GetRunAttemptUsage;
}

export function createRunObservabilityApplication(
  deps: RunObservabilityApplicationDependencies,
): RunObservabilityApplication {
  return {
    listRunSteps: new ListRunSteps(deps),
    getRunStep: new GetRunStep(deps),
    getRunAttemptUsage: new GetRunAttemptUsage(deps),
  };
}

async function assertRunAttemptOwnership(
  runs: RunRepository,
  workspaceId: WorkspaceId,
  runId: RunId,
  runAttemptId: RunAttemptId,
): Promise<void> {
  const run = await runs.findRunByWorkspaceAndId(workspaceId, runId);
  if (run === null) {
    throw new RunNotFoundError(runId);
  }

  const attempt = await runs.findRunAttemptById(runAttemptId);
  if (attempt === null || attempt.runId !== runId) {
    throw new RunAttemptNotFoundError(runAttemptId);
  }
}

function assertRunStepListLimit(limit: number): void {
  if (
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > MAX_RUN_STEP_LIST_LIMIT
  ) {
    throw new DomainInvariantError(
      `RunStep list limit must be an integer between 1 and ${String(MAX_RUN_STEP_LIST_LIMIT)}.`,
    );
  }
}

export { DEFAULT_RUN_STEP_LIST_LIMIT, MAX_RUN_STEP_LIST_LIMIT };
