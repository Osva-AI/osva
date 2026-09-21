import type {
  JsonValue,
  MemoryNamespaceId,
  WorkspaceId,
} from "@osva/contracts";
import { AUTHORIZATION_ACTIONS } from "@osva/contracts";

import { MemoryNamespace } from "./memory-namespace.js";
import { MemoryRecord } from "./memory-record.js";
import {
  MemoryNamespaceNotFoundError,
  WorkspaceNotFoundError,
} from "./errors.js";
import type {
  ListMemoryRecordsQuery,
  ListMemoryRecordsResult,
  MemoryNamespaceRepository,
} from "./ports/memory-namespace-repository.js";
import { DEFAULT_MEMORY_RECORD_LIST_LIMIT } from "./ports/memory-namespace-repository.js";
import type { WorkspaceRepository } from "./ports/workspace-repository.js";
import {
  controlPlaneWorkspaceId,
  requireControlPlaneAuthorization,
  type ControlPlaneScope,
} from "./control-plane.js";
import { CONTROL_PLANE_RESOURCE_KINDS } from "./control-plane-resource-kinds.js";

const MEMORY_RESOURCE = { kind: CONTROL_PLANE_RESOURCE_KINDS.memory };

export interface MemoryApplicationClock {
  now(): Date;
}

export interface MemoryApplicationIds {
  createId(): string;
}

export interface MemoryApplicationDependencies {
  readonly memoryNamespaces: MemoryNamespaceRepository;
  readonly workspaces: WorkspaceRepository;
  readonly clock: MemoryApplicationClock;
  readonly ids: MemoryApplicationIds;
}

export interface CreateMemoryNamespaceCommand {
  readonly workspaceId: WorkspaceId;
  readonly key: string;
  readonly name: string;
  readonly description?: string;
}

export class CreateMemoryNamespace {
  constructor(private readonly deps: MemoryApplicationDependencies) {}

  async execute(
    scope: ControlPlaneScope,
    command: CreateMemoryNamespaceCommand,
  ): Promise<MemoryNamespace> {
    requireControlPlaneAuthorization(
      scope,
      AUTHORIZATION_ACTIONS.WRITE,
      MEMORY_RESOURCE,
    );
    const workspaceId = controlPlaneWorkspaceId(scope);
    const workspace = await this.deps.workspaces.findById(workspaceId);
    if (workspace === null) {
      throw new WorkspaceNotFoundError(workspaceId);
    }

    const now = this.deps.clock.now();
    const namespace = MemoryNamespace.create({
      id: this.deps.ids.createId() as MemoryNamespaceId,
      workspaceId,
      key: command.key,
      name: command.name,
      description: command.description,
      createdAt: now,
      updatedAt: now,
    });

    await this.deps.memoryNamespaces.saveNamespace(namespace);
    return namespace;
  }
}

export class GetMemoryNamespace {
  constructor(private readonly deps: MemoryApplicationDependencies) {}

  async execute(
    scope: ControlPlaneScope,
    namespaceId: MemoryNamespaceId,
  ): Promise<MemoryNamespace> {
    requireControlPlaneAuthorization(
      scope,
      AUTHORIZATION_ACTIONS.READ,
      MEMORY_RESOURCE,
    );
    const namespace =
      await this.deps.memoryNamespaces.findNamespaceByWorkspaceAndId(
        controlPlaneWorkspaceId(scope),
        namespaceId,
      );
    if (namespace === null) {
      throw new MemoryNamespaceNotFoundError(namespaceId);
    }

    return namespace;
  }
}

export class ListMemoryNamespaces {
  constructor(private readonly deps: MemoryApplicationDependencies) {}

  async execute(scope: ControlPlaneScope): Promise<readonly MemoryNamespace[]> {
    requireControlPlaneAuthorization(
      scope,
      AUTHORIZATION_ACTIONS.READ,
      MEMORY_RESOURCE,
    );
    const workspaceId = controlPlaneWorkspaceId(scope);
    const workspace = await this.deps.workspaces.findById(workspaceId);
    if (workspace === null) {
      throw new WorkspaceNotFoundError(workspaceId);
    }

    return this.deps.memoryNamespaces.listNamespacesByWorkspace(workspaceId);
  }
}

export interface ListMemoryRecordsCommand {
  readonly namespaceId: MemoryNamespaceId;
  readonly prefix?: string;
  readonly limit?: number;
  readonly cursor?: string;
}

export class ListMemoryRecords {
  constructor(private readonly deps: MemoryApplicationDependencies) {}

  async execute(
    scope: ControlPlaneScope,
    command: ListMemoryRecordsCommand,
  ): Promise<ListMemoryRecordsResult> {
    requireControlPlaneAuthorization(
      scope,
      AUTHORIZATION_ACTIONS.READ,
      MEMORY_RESOURCE,
    );
    const namespace =
      await this.deps.memoryNamespaces.findNamespaceByWorkspaceAndId(
        controlPlaneWorkspaceId(scope),
        command.namespaceId,
      );
    if (namespace === null) {
      throw new MemoryNamespaceNotFoundError(command.namespaceId);
    }

    const query: ListMemoryRecordsQuery = {
      namespaceId: command.namespaceId,
      prefix: command.prefix,
      limit: command.limit ?? DEFAULT_MEMORY_RECORD_LIST_LIMIT,
      cursor: command.cursor,
    };

    return this.deps.memoryNamespaces.listRecords(query);
  }
}

export interface MemoryApplication {
  readonly createMemoryNamespace: CreateMemoryNamespace;
  readonly getMemoryNamespace: GetMemoryNamespace;
  readonly listMemoryNamespaces: ListMemoryNamespaces;
  readonly listMemoryRecords: ListMemoryRecords;
}

export function createMemoryApplication(
  deps: MemoryApplicationDependencies,
): MemoryApplication {
  return {
    createMemoryNamespace: new CreateMemoryNamespace(deps),
    getMemoryNamespace: new GetMemoryNamespace(deps),
    listMemoryNamespaces: new ListMemoryNamespaces(deps),
    listMemoryRecords: new ListMemoryRecords(deps),
  };
}

export type { MemoryRecord, JsonValue };
