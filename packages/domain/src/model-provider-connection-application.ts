import type {
  ModelProfileVersionId,
  ModelProvider,
  ModelProviderConnectionEndpoint,
  ModelProviderConnectionId,
  ModelProviderConnectionTestResult,
  ModelProviderConnectionVersionId,
  SecretReference,
  WorkspaceId,
} from "@osva-ai/contracts";
import {
  AUTHORIZATION_ACTIONS,
  connectionProviderSupportsCustomEndpoint,
  mapModelProviderConnectionVersionToPublicConfig,
} from "@osva-ai/contracts";

import {
  controlPlaneWorkspaceId,
  requireControlPlaneAuthorization,
  type ControlPlaneScope,
} from "./control-plane.js";
import { CONTROL_PLANE_RESOURCE_KINDS } from "./control-plane-resource-kinds.js";
import {
  DuplicateModelProviderConnectionKeyError,
  ModelProviderConnectionBindingError,
  ModelProviderConnectionNotFoundError,
  ModelProviderConnectionVersionNotFoundError,
  ModelProfileNotFoundError,
  ModelProfileVersionNotFoundError,
  WorkspaceNotFoundError,
} from "./errors.js";
import { ModelProviderConnection } from "./model-provider-connection.js";
import type { ModelProviderConnectionVersion } from "./model-provider-connection-version.js";
import type { ModelProviderConnectionRepository } from "./ports/model-provider-connection-repository.js";
import type { ModelProfileRepository } from "./ports/model-profile-repository.js";
import type { WorkspaceRepository } from "./ports/workspace-repository.js";

const CONNECTION_RESOURCE = {
  kind: CONTROL_PLANE_RESOURCE_KINDS.modelProviderConnection,
};

export interface ModelProviderConnectionApplicationClock {
  now(): Date;
}

export interface ModelProviderConnectionApplicationIds {
  createId(): string;
}

export interface ModelProviderConnectionTester {
  test(input: {
    readonly connection: ModelProviderConnection;
    readonly version: ModelProviderConnectionVersion;
    readonly model: string;
  }): Promise<ModelProviderConnectionTestResult>;
}

export interface ModelProviderConnectionApplicationDependencies {
  readonly connections: ModelProviderConnectionRepository;
  readonly modelProfiles?: ModelProfileRepository;
  readonly workspaces: WorkspaceRepository;
  readonly tester: ModelProviderConnectionTester;
  readonly clock: ModelProviderConnectionApplicationClock;
  readonly ids: ModelProviderConnectionApplicationIds;
}

export interface CreateModelProviderConnectionCommand {
  readonly workspaceId: WorkspaceId;
  readonly key: string;
  readonly name: string;
  readonly provider: ModelProvider;
}

export interface UpdateModelProviderConnectionMetadataCommand {
  readonly connectionId: ModelProviderConnectionId;
  readonly name: string;
}

export interface AppendModelProviderConnectionVersionCommand {
  readonly connectionId: ModelProviderConnectionId;
  readonly endpoint?: ModelProviderConnectionEndpoint;
  readonly credentialRef?: SecretReference;
}

export interface GetModelProviderConnectionVersionCommand {
  readonly connectionId: ModelProviderConnectionId;
  readonly connectionVersionId: ModelProviderConnectionVersionId;
}

export interface TestModelProviderConnectionVersionCommand {
  readonly connectionId: ModelProviderConnectionId;
  readonly connectionVersionId: ModelProviderConnectionVersionId;
  readonly model?: string;
  readonly modelProfileVersionId?: ModelProfileVersionId;
}

export class CreateModelProviderConnection {
  constructor(
    private readonly deps: ModelProviderConnectionApplicationDependencies,
  ) {}

  async execute(
    scope: ControlPlaneScope,
    command: CreateModelProviderConnectionCommand,
  ): Promise<ModelProviderConnection> {
    requireControlPlaneAuthorization(
      scope,
      AUTHORIZATION_ACTIONS.WRITE,
      CONNECTION_RESOURCE,
    );
    const workspaceId = controlPlaneWorkspaceId(scope);
    const workspace = await this.deps.workspaces.findById(workspaceId);
    if (workspace === null) {
      throw new WorkspaceNotFoundError(workspaceId);
    }

    const now = this.deps.clock.now();
    const connection = ModelProviderConnection.create({
      id: this.deps.ids.createId() as ModelProviderConnectionId,
      workspaceId,
      key: command.key,
      name: command.name,
      provider: command.provider,
      createdAt: now,
      updatedAt: now,
    });

    try {
      await this.deps.connections.saveConnection(connection);
    } catch (error) {
      if (error instanceof DuplicateModelProviderConnectionKeyError) {
        throw error;
      }
      throw error;
    }

    return connection;
  }
}

export class GetModelProviderConnection {
  constructor(
    private readonly deps: ModelProviderConnectionApplicationDependencies,
  ) {}

  async execute(
    scope: ControlPlaneScope,
    connectionId: ModelProviderConnectionId,
  ): Promise<ModelProviderConnection> {
    requireControlPlaneAuthorization(
      scope,
      AUTHORIZATION_ACTIONS.READ,
      CONNECTION_RESOURCE,
    );
    const connection =
      await this.deps.connections.findConnectionByWorkspaceAndId(
        controlPlaneWorkspaceId(scope),
        connectionId,
      );
    if (connection === null) {
      throw new ModelProviderConnectionNotFoundError(connectionId);
    }

    return connection;
  }
}

export class ListModelProviderConnections {
  constructor(
    private readonly deps: ModelProviderConnectionApplicationDependencies,
  ) {}

  async execute(scope: ControlPlaneScope): Promise<ModelProviderConnection[]> {
    requireControlPlaneAuthorization(
      scope,
      AUTHORIZATION_ACTIONS.READ,
      CONNECTION_RESOURCE,
    );
    return this.deps.connections.listConnectionsByWorkspaceId(
      controlPlaneWorkspaceId(scope),
    );
  }
}

export class UpdateModelProviderConnectionMetadata {
  constructor(
    private readonly deps: ModelProviderConnectionApplicationDependencies,
  ) {}

  async execute(
    scope: ControlPlaneScope,
    command: UpdateModelProviderConnectionMetadataCommand,
  ): Promise<ModelProviderConnection> {
    requireControlPlaneAuthorization(
      scope,
      AUTHORIZATION_ACTIONS.WRITE,
      CONNECTION_RESOURCE,
    );
    const existing = await this.deps.connections.findConnectionByWorkspaceAndId(
      controlPlaneWorkspaceId(scope),
      command.connectionId,
    );
    if (existing === null) {
      throw new ModelProviderConnectionNotFoundError(command.connectionId);
    }

    const updated = await this.deps.connections.updateConnectionMetadata(
      command.connectionId,
      {
        name: command.name,
        updatedAt: this.deps.clock.now(),
      },
    );
    if (updated === null) {
      throw new ModelProviderConnectionNotFoundError(command.connectionId);
    }

    return updated;
  }
}

export class AppendModelProviderConnectionVersion {
  constructor(
    private readonly deps: ModelProviderConnectionApplicationDependencies,
  ) {}

  async execute(
    scope: ControlPlaneScope,
    command: AppendModelProviderConnectionVersionCommand,
  ): Promise<ModelProviderConnectionVersion> {
    requireControlPlaneAuthorization(
      scope,
      AUTHORIZATION_ACTIONS.WRITE,
      CONNECTION_RESOURCE,
    );
    const connection =
      await this.deps.connections.findConnectionByWorkspaceAndId(
        controlPlaneWorkspaceId(scope),
        command.connectionId,
      );
    if (connection === null) {
      throw new ModelProviderConnectionNotFoundError(command.connectionId);
    }

    if (
      command.endpoint !== undefined &&
      !connectionProviderSupportsCustomEndpoint(connection.provider)
    ) {
      throw new ModelProviderConnectionBindingError(
        "Custom endpoints are not supported for this provider connection.",
      );
    }

    return this.deps.connections.appendConnectionVersion({
      id: this.deps.ids.createId() as ModelProviderConnectionVersionId,
      connectionId: command.connectionId,
      endpoint: command.endpoint,
      credentialRef: command.credentialRef,
      createdAt: this.deps.clock.now(),
    });
  }
}

export class GetModelProviderConnectionVersion {
  constructor(
    private readonly deps: ModelProviderConnectionApplicationDependencies,
  ) {}

  async execute(
    scope: ControlPlaneScope,
    command: GetModelProviderConnectionVersionCommand,
  ): Promise<ModelProviderConnectionVersion> {
    requireControlPlaneAuthorization(
      scope,
      AUTHORIZATION_ACTIONS.READ,
      CONNECTION_RESOURCE,
    );
    const connection =
      await this.deps.connections.findConnectionByWorkspaceAndId(
        controlPlaneWorkspaceId(scope),
        command.connectionId,
      );
    if (connection === null) {
      throw new ModelProviderConnectionNotFoundError(command.connectionId);
    }

    const version =
      await this.deps.connections.findConnectionVersionByConnectionAndId(
        command.connectionId,
        command.connectionVersionId,
      );
    if (version === null) {
      throw new ModelProviderConnectionVersionNotFoundError(
        command.connectionVersionId,
      );
    }

    return version;
  }
}

export class ListModelProviderConnectionVersions {
  constructor(
    private readonly deps: ModelProviderConnectionApplicationDependencies,
  ) {}

  async execute(
    scope: ControlPlaneScope,
    connectionId: ModelProviderConnectionId,
  ): Promise<ModelProviderConnectionVersion[]> {
    requireControlPlaneAuthorization(
      scope,
      AUTHORIZATION_ACTIONS.READ,
      CONNECTION_RESOURCE,
    );
    const connection =
      await this.deps.connections.findConnectionByWorkspaceAndId(
        controlPlaneWorkspaceId(scope),
        connectionId,
      );
    if (connection === null) {
      throw new ModelProviderConnectionNotFoundError(connectionId);
    }

    return this.deps.connections.listConnectionVersions(connectionId);
  }
}

export class TestModelProviderConnectionVersion {
  constructor(
    private readonly deps: ModelProviderConnectionApplicationDependencies,
  ) {}

  async execute(
    scope: ControlPlaneScope,
    command: TestModelProviderConnectionVersionCommand,
  ): Promise<ModelProviderConnectionTestResult> {
    requireControlPlaneAuthorization(
      scope,
      AUTHORIZATION_ACTIONS.EXECUTE,
      CONNECTION_RESOURCE,
    );
    const connection =
      await this.deps.connections.findConnectionByWorkspaceAndId(
        controlPlaneWorkspaceId(scope),
        command.connectionId,
      );
    if (connection === null) {
      throw new ModelProviderConnectionNotFoundError(command.connectionId);
    }

    const version =
      await this.deps.connections.findConnectionVersionByConnectionAndId(
        command.connectionId,
        command.connectionVersionId,
      );
    if (version === null) {
      throw new ModelProviderConnectionVersionNotFoundError(
        command.connectionVersionId,
      );
    }

    const model = await resolveModelProviderConnectionTestModel({
      scope,
      command,
      connection,
      version,
      modelProfiles: this.deps.modelProfiles,
      connections: this.deps.connections,
    });

    return this.deps.tester.test({
      connection,
      version,
      model,
    });
  }
}

async function resolveModelProviderConnectionTestModel(input: {
  readonly scope: ControlPlaneScope;
  readonly command: TestModelProviderConnectionVersionCommand;
  readonly connection: ModelProviderConnection;
  readonly version: ModelProviderConnectionVersion;
  readonly modelProfiles: ModelProfileRepository | undefined;
  readonly connections: ModelProviderConnectionRepository;
}): Promise<string> {
  const explicitModel = input.command.model?.trim();
  if (explicitModel !== undefined && explicitModel.length > 0) {
    return explicitModel;
  }

  const modelProfileVersionId = input.command.modelProfileVersionId;
  if (modelProfileVersionId === undefined) {
    throw new ModelProviderConnectionBindingError(
      "Connectivity tests require an explicit model or modelProfileVersionId.",
    );
  }

  if (input.modelProfiles === undefined) {
    throw new ModelProviderConnectionBindingError(
      "Model profiles are not configured for connectivity testing.",
    );
  }

  const modelProfileVersion =
    await input.modelProfiles.findModelProfileVersionById(
      modelProfileVersionId,
    );
  if (modelProfileVersion === null) {
    throw new ModelProfileVersionNotFoundError(modelProfileVersionId);
  }

  const profile = await input.modelProfiles.findModelProfileById(
    modelProfileVersion.modelProfileId,
  );
  if (profile === null) {
    throw new ModelProfileNotFoundError(modelProfileVersion.modelProfileId);
  }

  if (profile.workspaceId !== controlPlaneWorkspaceId(input.scope)) {
    throw new ModelProfileVersionNotFoundError(modelProfileVersionId);
  }

  if (
    modelProfileVersion.modelProviderConnectionVersionId !==
    input.command.connectionVersionId
  ) {
    throw new ModelProviderConnectionBindingError(
      "ModelProfileVersion is not bound to the requested connection version.",
    );
  }

  if (modelProfileVersion.provider !== input.connection.provider) {
    throw new ModelProviderConnectionBindingError(
      "ModelProfileVersion provider must match the provider connection.",
    );
  }

  const boundVersion = await input.connections.findConnectionVersionById(
    input.command.connectionVersionId,
  );
  if (
    boundVersion === null ||
    boundVersion.connectionId !== input.command.connectionId
  ) {
    throw new ModelProviderConnectionVersionNotFoundError(
      input.command.connectionVersionId,
    );
  }

  return modelProfileVersion.model;
}

export interface ModelProviderConnectionApplication {
  readonly createModelProviderConnection: CreateModelProviderConnection;
  readonly getModelProviderConnection: GetModelProviderConnection;
  readonly listModelProviderConnections: ListModelProviderConnections;
  readonly updateModelProviderConnectionMetadata: UpdateModelProviderConnectionMetadata;
  readonly appendModelProviderConnectionVersion: AppendModelProviderConnectionVersion;
  readonly getModelProviderConnectionVersion: GetModelProviderConnectionVersion;
  readonly listModelProviderConnectionVersions: ListModelProviderConnectionVersions;
  readonly testModelProviderConnectionVersion: TestModelProviderConnectionVersion;
}

export function createModelProviderConnectionApplication(
  deps: ModelProviderConnectionApplicationDependencies,
): ModelProviderConnectionApplication {
  return {
    createModelProviderConnection: new CreateModelProviderConnection(deps),
    getModelProviderConnection: new GetModelProviderConnection(deps),
    listModelProviderConnections: new ListModelProviderConnections(deps),
    updateModelProviderConnectionMetadata:
      new UpdateModelProviderConnectionMetadata(deps),
    appendModelProviderConnectionVersion:
      new AppendModelProviderConnectionVersion(deps),
    getModelProviderConnectionVersion: new GetModelProviderConnectionVersion(
      deps,
    ),
    listModelProviderConnectionVersions:
      new ListModelProviderConnectionVersions(deps),
    testModelProviderConnectionVersion: new TestModelProviderConnectionVersion(
      deps,
    ),
  };
}

export function mapModelProviderConnectionVersionToResource(input: {
  readonly connection: ModelProviderConnection;
  readonly version: ModelProviderConnectionVersion;
}) {
  const publicConfig = mapModelProviderConnectionVersionToPublicConfig({
    endpoint: input.version.endpoint,
    credentialRef: input.version.credentialRef,
  });

  return {
    id: input.version.id,
    connectionId: input.version.connectionId,
    version: input.version.version,
    provider: input.connection.provider,
    ...publicConfig,
    createdAt: input.version.createdAt.toISOString(),
  };
}
