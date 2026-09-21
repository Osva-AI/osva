import type {
  EvaluationCaseId,
  EvaluationCaseDefinitionV1,
  EvaluationSuiteId,
  EvaluationSuiteVersionId,
  WorkspaceId,
} from "@osva/contracts";
import { AUTHORIZATION_ACTIONS } from "@osva/contracts";

import { EvaluationCase } from "./evaluation-case.js";
import { EvaluationSuite } from "./evaluation-suite.js";
import { EvaluationSuiteVersion } from "./evaluation-suite-version.js";
import {
  EvaluationSuiteNotFoundError,
  EvaluationSuiteVersionNotFoundError,
  WorkspaceNotFoundError,
} from "./errors.js";
import type { EvaluationSuiteRepository } from "./ports/evaluation-suite-repository.js";
import type { WorkspaceRepository } from "./ports/workspace-repository.js";
import {
  controlPlaneWorkspaceId,
  requireControlPlaneAuthorization,
  type ControlPlaneScope,
} from "./control-plane.js";
import { CONTROL_PLANE_RESOURCE_KINDS } from "./control-plane-resource-kinds.js";

const EVALUATION_SUITE_RESOURCE = {
  kind: CONTROL_PLANE_RESOURCE_KINDS.evaluationSuite,
};

export interface EvaluationSuiteApplicationClock {
  now(): Date;
}

export interface EvaluationSuiteApplicationIds {
  createId(): string;
}

export interface EvaluationSuiteApplicationDependencies {
  readonly evaluationSuites: EvaluationSuiteRepository;
  readonly workspaces: WorkspaceRepository;
  readonly clock: EvaluationSuiteApplicationClock;
  readonly ids: EvaluationSuiteApplicationIds;
}

export interface CreateEvaluationSuiteCommand {
  readonly workspaceId: WorkspaceId;
  readonly key: string;
  readonly name: string;
  readonly description?: string;
}

export interface AppendEvaluationSuiteVersionCommand {
  readonly evaluationSuiteId: EvaluationSuiteId;
  readonly cases: readonly EvaluationCaseDefinitionV1[];
}

export interface GetEvaluationSuiteVersionCommand {
  readonly evaluationSuiteId: EvaluationSuiteId;
  readonly evaluationSuiteVersionId: EvaluationSuiteVersionId;
}

export class CreateEvaluationSuite {
  constructor(private readonly deps: EvaluationSuiteApplicationDependencies) {}

  async execute(
    scope: ControlPlaneScope,
    command: CreateEvaluationSuiteCommand,
  ): Promise<EvaluationSuite> {
    requireControlPlaneAuthorization(
      scope,
      AUTHORIZATION_ACTIONS.WRITE,
      EVALUATION_SUITE_RESOURCE,
    );
    const workspaceId = controlPlaneWorkspaceId(scope);
    const workspace = await this.deps.workspaces.findById(workspaceId);
    if (workspace === null) {
      throw new WorkspaceNotFoundError(workspaceId);
    }

    const now = this.deps.clock.now();
    const suite = EvaluationSuite.create({
      id: this.deps.ids.createId() as EvaluationSuiteId,
      workspaceId,
      key: command.key,
      name: command.name,
      description: command.description,
      createdAt: now,
      updatedAt: now,
    });

    await this.deps.evaluationSuites.saveSuite(suite);
    return suite;
  }
}

export class GetEvaluationSuite {
  constructor(private readonly deps: EvaluationSuiteApplicationDependencies) {}

  async execute(
    scope: ControlPlaneScope,
    evaluationSuiteId: EvaluationSuiteId,
  ): Promise<EvaluationSuite> {
    requireControlPlaneAuthorization(
      scope,
      AUTHORIZATION_ACTIONS.READ,
      EVALUATION_SUITE_RESOURCE,
    );
    const suite = await this.deps.evaluationSuites.findSuiteByWorkspaceAndId(
      controlPlaneWorkspaceId(scope),
      evaluationSuiteId,
    );
    if (suite === null) {
      throw new EvaluationSuiteNotFoundError(evaluationSuiteId);
    }

    return suite;
  }
}

export class ListEvaluationSuites {
  constructor(private readonly deps: EvaluationSuiteApplicationDependencies) {}

  async execute(scope: ControlPlaneScope): Promise<readonly EvaluationSuite[]> {
    requireControlPlaneAuthorization(
      scope,
      AUTHORIZATION_ACTIONS.READ,
      EVALUATION_SUITE_RESOURCE,
    );
    const workspaceId = controlPlaneWorkspaceId(scope);
    const workspace = await this.deps.workspaces.findById(workspaceId);
    if (workspace === null) {
      throw new WorkspaceNotFoundError(workspaceId);
    }

    return this.deps.evaluationSuites.listSuitesByWorkspace(workspaceId);
  }
}

export class AppendEvaluationSuiteVersion {
  constructor(private readonly deps: EvaluationSuiteApplicationDependencies) {}

  async execute(
    scope: ControlPlaneScope,
    command: AppendEvaluationSuiteVersionCommand,
  ): Promise<EvaluationSuiteVersion> {
    requireControlPlaneAuthorization(
      scope,
      AUTHORIZATION_ACTIONS.WRITE,
      EVALUATION_SUITE_RESOURCE,
    );
    const suite = await this.deps.evaluationSuites.findSuiteByWorkspaceAndId(
      controlPlaneWorkspaceId(scope),
      command.evaluationSuiteId,
    );
    if (suite === null) {
      throw new EvaluationSuiteNotFoundError(command.evaluationSuiteId);
    }

    const existingVersions =
      await this.deps.evaluationSuites.listSuiteVersionsBySuite(
        command.evaluationSuiteId,
      );
    const nextVersion =
      existingVersions.reduce(
        (max, version) => Math.max(max, version.version),
        0,
      ) + 1;

    const versionId = this.deps.ids.createId() as EvaluationSuiteVersionId;
    const createdAt = this.deps.clock.now();
    const sortedCases = [...command.cases].sort((left, right) =>
      left.key.localeCompare(right.key),
    );
    const cases = sortedCases.map((definition) =>
      EvaluationCase.create({
        id: this.deps.ids.createId() as EvaluationCaseId,
        evaluationSuiteVersionId: versionId,
        key: definition.key,
        name: definition.name,
        input: definition.input,
        expected: definition.expected,
        evaluator: definition.evaluator,
        createdAt,
      }),
    );

    const version = EvaluationSuiteVersion.create({
      id: versionId,
      evaluationSuiteId: command.evaluationSuiteId,
      workspaceId: suite.workspaceId,
      version: nextVersion,
      cases,
      createdAt,
    });

    await this.deps.evaluationSuites.saveSuiteVersion(version);
    return version;
  }
}

export class GetEvaluationSuiteVersion {
  constructor(private readonly deps: EvaluationSuiteApplicationDependencies) {}

  async execute(
    scope: ControlPlaneScope,
    command: GetEvaluationSuiteVersionCommand,
  ): Promise<EvaluationSuiteVersion> {
    requireControlPlaneAuthorization(
      scope,
      AUTHORIZATION_ACTIONS.READ,
      EVALUATION_SUITE_RESOURCE,
    );
    const suite = await this.deps.evaluationSuites.findSuiteByWorkspaceAndId(
      controlPlaneWorkspaceId(scope),
      command.evaluationSuiteId,
    );
    if (suite === null) {
      throw new EvaluationSuiteNotFoundError(command.evaluationSuiteId);
    }

    const version = await this.deps.evaluationSuites.findSuiteVersionById(
      command.evaluationSuiteVersionId,
    );
    if (
      version === null ||
      version.evaluationSuiteId !== command.evaluationSuiteId
    ) {
      throw new EvaluationSuiteVersionNotFoundError(
        command.evaluationSuiteVersionId,
      );
    }

    return version;
  }
}

export class ListEvaluationSuiteVersions {
  constructor(private readonly deps: EvaluationSuiteApplicationDependencies) {}

  async execute(
    scope: ControlPlaneScope,
    evaluationSuiteId: EvaluationSuiteId,
  ): Promise<readonly EvaluationSuiteVersion[]> {
    requireControlPlaneAuthorization(
      scope,
      AUTHORIZATION_ACTIONS.READ,
      EVALUATION_SUITE_RESOURCE,
    );
    const suite = await this.deps.evaluationSuites.findSuiteByWorkspaceAndId(
      controlPlaneWorkspaceId(scope),
      evaluationSuiteId,
    );
    if (suite === null) {
      throw new EvaluationSuiteNotFoundError(evaluationSuiteId);
    }

    return this.deps.evaluationSuites.listSuiteVersionsBySuite(
      evaluationSuiteId,
    );
  }
}

export interface EvaluationSuiteApplication {
  readonly createEvaluationSuite: CreateEvaluationSuite;
  readonly getEvaluationSuite: GetEvaluationSuite;
  readonly listEvaluationSuites: ListEvaluationSuites;
  readonly appendEvaluationSuiteVersion: AppendEvaluationSuiteVersion;
  readonly getEvaluationSuiteVersion: GetEvaluationSuiteVersion;
  readonly listEvaluationSuiteVersions: ListEvaluationSuiteVersions;
}

export function createEvaluationSuiteApplication(
  deps: EvaluationSuiteApplicationDependencies,
): EvaluationSuiteApplication {
  return {
    createEvaluationSuite: new CreateEvaluationSuite(deps),
    getEvaluationSuite: new GetEvaluationSuite(deps),
    listEvaluationSuites: new ListEvaluationSuites(deps),
    appendEvaluationSuiteVersion: new AppendEvaluationSuiteVersion(deps),
    getEvaluationSuiteVersion: new GetEvaluationSuiteVersion(deps),
    listEvaluationSuiteVersions: new ListEvaluationSuiteVersions(deps),
  };
}
