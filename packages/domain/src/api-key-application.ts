import type {
  ApiKeyId,
  CommunityEditionRole,
  WorkspaceId,
} from "@osva/contracts";
import {
  AUTHORIZATION_ACTIONS,
  COMMUNITY_EDITION_ROLES,
} from "@osva/contracts";

import { ApiKey } from "./api-key.js";
import { generateApiKeySecretMaterial } from "./api-key-credential.js";
import { WorkspaceNotFoundError } from "./errors.js";
import {
  controlPlaneWorkspaceId,
  requireControlPlaneAuthorization,
  type ControlPlaneScope,
} from "./control-plane.js";
import { CONTROL_PLANE_RESOURCE_KINDS } from "./control-plane-resource-kinds.js";
import {
  ApiKeyNotFoundError,
  BootstrapAlreadyCompletedError,
  BootstrapExistingWorkspaceStateError,
} from "./security-errors.js";
import type { ApiKeyRepository } from "./ports/api-key-repository.js";
import type { WorkspaceRepository } from "./ports/workspace-repository.js";
import { Workspace } from "./workspace.js";

export interface ApiKeyApplicationClock {
  now(): Date;
}

export interface ApiKeyApplicationIds {
  createId(): string;
}

export interface ApiKeyApplicationDependencies {
  readonly apiKeys: ApiKeyRepository;
  readonly workspaces: WorkspaceRepository;
  readonly clock: ApiKeyApplicationClock;
  readonly ids: ApiKeyApplicationIds;
}

export interface CreateApiKeyCommand {
  readonly workspaceId: WorkspaceId;
  readonly name: string;
  readonly role: CommunityEditionRole;
  readonly expiresAt?: Date;
}

export interface CreateApiKeyResult {
  readonly apiKey: ApiKey;
  readonly plaintextToken: string;
}

export class CreateApiKey {
  constructor(private readonly deps: ApiKeyApplicationDependencies) {}

  async execute(command: CreateApiKeyCommand): Promise<CreateApiKeyResult> {
    const workspace = await this.deps.workspaces.findById(command.workspaceId);
    if (workspace === null) {
      throw new WorkspaceNotFoundError(command.workspaceId);
    }

    const now = this.deps.clock.now();
    const apiKeyId = this.deps.ids.createId() as ApiKeyId;
    const apiKey = ApiKey.create({
      id: apiKeyId,
      workspaceId: command.workspaceId,
      name: command.name,
      role: command.role,
      now,
      expiresAt: command.expiresAt,
    });
    const secretMaterial = generateApiKeySecretMaterial(apiKeyId);

    await this.deps.apiKeys.create({
      apiKey,
      secretDigest: secretMaterial.secretDigest,
    });

    return {
      apiKey,
      plaintextToken: secretMaterial.plaintextToken,
    };
  }
}

export interface BootstrapInstallationCommand {
  readonly workspaceName?: string;
  readonly workspaceId?: WorkspaceId;
  readonly apiKeyName?: string;
}

export interface BootstrapInstallationResult {
  readonly workspace: Workspace;
  readonly apiKey: ApiKey;
  readonly plaintextToken: string;
}

export class BootstrapInstallation {
  constructor(private readonly deps: ApiKeyApplicationDependencies) {}

  async execute(
    command: BootstrapInstallationCommand,
  ): Promise<BootstrapInstallationResult> {
    if ((await this.deps.apiKeys.countAll()) > 0) {
      throw new BootstrapAlreadyCompletedError();
    }

    const workspaceCount = await this.deps.workspaces.countAll();
    if (workspaceCount > 0) {
      if (command.workspaceId === undefined) {
        throw new BootstrapExistingWorkspaceStateError(workspaceCount);
      }

      const workspace = await this.deps.workspaces.findById(
        command.workspaceId,
      );
      if (workspace === null) {
        throw new WorkspaceNotFoundError(command.workspaceId);
      }

      const createApiKey = new CreateApiKey(this.deps);
      const created = await createApiKey.execute({
        workspaceId: workspace.id,
        name: command.apiKeyName ?? "bootstrap-admin",
        role: COMMUNITY_EDITION_ROLES.ADMIN,
      });

      return {
        workspace,
        apiKey: created.apiKey,
        plaintextToken: created.plaintextToken,
      };
    }

    const workspaceName = command.workspaceName?.trim();
    if (workspaceName === undefined || workspaceName.length === 0) {
      throw new Error(
        "Bootstrap requires a workspace name when no workspaces exist.",
      );
    }

    const now = this.deps.clock.now();
    const workspace = Workspace.create({
      id: this.deps.ids.createId() as WorkspaceId,
      name: workspaceName,
      createdAt: now,
    });
    await this.deps.workspaces.save(workspace);

    const createApiKey = new CreateApiKey(this.deps);
    const created = await createApiKey.execute({
      workspaceId: workspace.id,
      name: command.apiKeyName ?? "bootstrap-admin",
      role: COMMUNITY_EDITION_ROLES.ADMIN,
    });

    return {
      workspace,
      apiKey: created.apiKey,
      plaintextToken: created.plaintextToken,
    };
  }
}

const API_KEY_RESOURCE = { kind: CONTROL_PLANE_RESOURCE_KINDS.apiKey } as const;

export interface CreateWorkspaceApiKeyCommand {
  readonly name: string;
  readonly role: CommunityEditionRole;
  readonly expiresAt?: Date;
}

export class CreateWorkspaceApiKey {
  constructor(private readonly deps: ApiKeyApplicationDependencies) {}

  async execute(
    scope: ControlPlaneScope,
    command: CreateWorkspaceApiKeyCommand,
  ): Promise<CreateApiKeyResult> {
    requireControlPlaneAuthorization(
      scope,
      AUTHORIZATION_ACTIONS.ADMIN,
      API_KEY_RESOURCE,
    );

    const createApiKey = new CreateApiKey(this.deps);
    return createApiKey.execute({
      workspaceId: controlPlaneWorkspaceId(scope),
      name: command.name,
      role: command.role,
      expiresAt: command.expiresAt,
    });
  }
}

export class ListWorkspaceApiKeys {
  constructor(private readonly deps: ApiKeyApplicationDependencies) {}

  async execute(scope: ControlPlaneScope): Promise<readonly ApiKey[]> {
    requireControlPlaneAuthorization(
      scope,
      AUTHORIZATION_ACTIONS.READ,
      API_KEY_RESOURCE,
    );

    return this.deps.apiKeys.listByWorkspaceId(controlPlaneWorkspaceId(scope));
  }
}

export class RevokeWorkspaceApiKey {
  constructor(private readonly deps: ApiKeyApplicationDependencies) {}

  async execute(scope: ControlPlaneScope, apiKeyId: ApiKeyId): Promise<ApiKey> {
    requireControlPlaneAuthorization(
      scope,
      AUTHORIZATION_ACTIONS.ADMIN,
      API_KEY_RESOURCE,
    );

    const workspaceId = controlPlaneWorkspaceId(scope);
    const existing = await this.deps.apiKeys.findByWorkspaceAndId(
      workspaceId,
      apiKeyId,
    );
    if (existing === null) {
      throw new ApiKeyNotFoundError(apiKeyId);
    }

    await this.deps.apiKeys.revoke(apiKeyId, this.deps.clock.now());
    const revoked = await this.deps.apiKeys.findByWorkspaceAndId(
      workspaceId,
      apiKeyId,
    );
    if (revoked === null) {
      throw new ApiKeyNotFoundError(apiKeyId);
    }

    return revoked;
  }
}

export interface ApiKeyApplication {
  readonly createApiKey: CreateApiKey;
  readonly bootstrapInstallation: BootstrapInstallation;
  readonly createWorkspaceApiKey: CreateWorkspaceApiKey;
  readonly listWorkspaceApiKeys: ListWorkspaceApiKeys;
  readonly revokeWorkspaceApiKey: RevokeWorkspaceApiKey;
}

export function createApiKeyApplication(
  deps: ApiKeyApplicationDependencies,
): ApiKeyApplication {
  return {
    createApiKey: new CreateApiKey(deps),
    bootstrapInstallation: new BootstrapInstallation(deps),
    createWorkspaceApiKey: new CreateWorkspaceApiKey(deps),
    listWorkspaceApiKeys: new ListWorkspaceApiKeys(deps),
    revokeWorkspaceApiKey: new RevokeWorkspaceApiKey(deps),
  };
}
