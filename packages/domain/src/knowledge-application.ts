import type {
  ArtifactId,
  JsonObject,
  KnowledgeIndexId,
  KnowledgeSourceId,
  WorkspaceId,
} from "@osva/contracts";
import { AUTHORIZATION_ACTIONS } from "@osva/contracts";

import {
  ArtifactNotFoundError,
  ArtifactWorkspaceMismatchError,
  KnowledgeIdempotencyConflictError,
  KnowledgeIndexNotFoundError,
  KnowledgeIndexNotRetryableError,
  KnowledgeSourceNotFoundError,
  WorkspaceNotFoundError,
} from "./errors.js";
import { jsonValuesEqual } from "./json-equality.js";
import { KnowledgeIndex } from "./knowledge-index.js";
import { computeKnowledgePipelineFingerprint } from "./knowledge-pipeline-fingerprint.js";
import {
  resolveDefaultKnowledgePipeline,
  type KnowledgeEmbeddingDefaults,
} from "./knowledge-pipeline-config.js";
import { KnowledgeSource } from "./knowledge-source.js";
import type { ArtifactRepository } from "./ports/artifact-repository.js";
import type { KnowledgeIndexQueue } from "./ports/knowledge-index-queue.js";
import {
  DEFAULT_KNOWLEDGE_INDEX_LIST_LIMIT,
  DEFAULT_KNOWLEDGE_SOURCE_LIST_LIMIT,
  MAX_KNOWLEDGE_INDEX_LIST_LIMIT,
  MAX_KNOWLEDGE_SOURCE_LIST_LIMIT,
  type KnowledgeRepository,
  type ListKnowledgeIndexesQuery,
  type ListKnowledgeSourcesQuery,
} from "./ports/knowledge-repository.js";
import {
  controlPlaneWorkspaceId,
  requireControlPlaneAuthorization,
  type ControlPlaneScope,
} from "./control-plane.js";
import { CONTROL_PLANE_RESOURCE_KINDS } from "./control-plane-resource-kinds.js";

const KNOWLEDGE_RESOURCE = { kind: CONTROL_PLANE_RESOURCE_KINDS.knowledge };

import type { WorkspaceRepository } from "./ports/workspace-repository.js";

export interface KnowledgeApplicationClock {
  now(): Date;
}

export interface KnowledgeApplicationIds {
  createId(): string;
}

export interface KnowledgeApplicationDependencies {
  readonly knowledge: KnowledgeRepository;
  readonly artifacts: ArtifactRepository;
  readonly workspaces: WorkspaceRepository;
  readonly indexQueue: KnowledgeIndexQueue;
  readonly embeddingDefaults: KnowledgeEmbeddingDefaults;
  readonly clock: KnowledgeApplicationClock;
  readonly ids: KnowledgeApplicationIds;
}

export interface CreateKnowledgeSourceCommand {
  readonly workspaceId: WorkspaceId;
  readonly key: string;
  readonly name: string;
  readonly artifactId: ArtifactId;
  readonly attributes?: JsonObject;
  readonly idempotencyKey?: string;
}

export interface CreateKnowledgeIndexCommand {
  readonly workspaceId: WorkspaceId;
  readonly knowledgeSourceId: KnowledgeSourceId;
  readonly idempotencyKey?: string;
}

export class CreateKnowledgeSource {
  constructor(private readonly deps: KnowledgeApplicationDependencies) {}

  async execute(
    scope: ControlPlaneScope,
    command: CreateKnowledgeSourceCommand,
  ): Promise<KnowledgeSource> {
    requireControlPlaneAuthorization(
      scope,
      AUTHORIZATION_ACTIONS.WRITE,
      KNOWLEDGE_RESOURCE,
    );
    const workspace = await this.deps.workspaces.findById(
      controlPlaneWorkspaceId(scope),
    );
    if (workspace === null) {
      throw new WorkspaceNotFoundError(controlPlaneWorkspaceId(scope));
    }

    const artifact = await this.deps.artifacts.findByWorkspaceAndId(
      controlPlaneWorkspaceId(scope),
      command.artifactId,
    );
    if (artifact === null) {
      throw new ArtifactNotFoundError(command.artifactId);
    }
    if (artifact.workspaceId !== command.workspaceId) {
      throw new ArtifactWorkspaceMismatchError(
        command.artifactId,
        command.workspaceId,
      );
    }

    if (command.idempotencyKey !== undefined) {
      const existing =
        await this.deps.knowledge.findSourceByWorkspaceIdempotencyKey(
          command.workspaceId,
          command.idempotencyKey,
        );
      if (existing !== null) {
        assertSourceReplay(existing, command);
        return existing;
      }
    }

    const source = KnowledgeSource.create({
      id: this.deps.ids.createId() as KnowledgeSourceId,
      workspaceId: controlPlaneWorkspaceId(scope),
      key: command.key,
      name: command.name,
      artifactId: command.artifactId,
      attributes: command.attributes,
      idempotencyKey: command.idempotencyKey,
      createdAt: this.deps.clock.now(),
    });

    await this.deps.knowledge.saveSource(source);
    return source;
  }
}

export class CreateKnowledgeIndex {
  constructor(private readonly deps: KnowledgeApplicationDependencies) {}

  async execute(
    scope: ControlPlaneScope,
    command: CreateKnowledgeIndexCommand,
  ): Promise<KnowledgeIndex> {
    requireControlPlaneAuthorization(
      scope,
      AUTHORIZATION_ACTIONS.WRITE,
      KNOWLEDGE_RESOURCE,
    );
    const source = await this.deps.knowledge.findSourceById(
      command.knowledgeSourceId,
    );
    if (source === null) {
      throw new KnowledgeSourceNotFoundError(command.knowledgeSourceId);
    }
    if (source.workspaceId !== command.workspaceId) {
      throw new KnowledgeSourceNotFoundError(command.knowledgeSourceId);
    }

    const pipeline = resolveDefaultKnowledgePipeline(
      this.deps.embeddingDefaults,
    );
    const fingerprint = computeKnowledgePipelineFingerprint(pipeline);

    if (command.idempotencyKey !== undefined) {
      const existing =
        await this.deps.knowledge.findIndexByWorkspaceIdempotencyKey(
          command.workspaceId,
          command.idempotencyKey,
        );
      if (existing !== null) {
        if (
          existing.knowledgeSourceId !== command.knowledgeSourceId ||
          existing.pipelineFingerprint !== fingerprint
        ) {
          throw new KnowledgeIdempotencyConflictError(
            command.workspaceId,
            command.idempotencyKey,
          );
        }
        return existing;
      }
    }

    const index = KnowledgeIndex.create({
      id: this.deps.ids.createId() as KnowledgeIndexId,
      workspaceId: controlPlaneWorkspaceId(scope),
      knowledgeSourceId: command.knowledgeSourceId,
      ...pipeline,
      pipelineFingerprint: fingerprint,
      idempotencyKey: command.idempotencyKey,
      createdAt: this.deps.clock.now(),
    });

    await this.deps.knowledge.saveIndex(index);
    await this.deps.indexQueue.enqueue(index.id);
    return index;
  }
}

export class RetryKnowledgeIndex {
  constructor(private readonly deps: KnowledgeApplicationDependencies) {}

  async execute(
    scope: ControlPlaneScope,
    workspaceId: WorkspaceId,
    knowledgeIndexId: KnowledgeIndexId,
  ): Promise<KnowledgeIndex> {
    requireControlPlaneAuthorization(
      scope,
      AUTHORIZATION_ACTIONS.WRITE,
      KNOWLEDGE_RESOURCE,
    );
    const index = await this.deps.knowledge.findIndexByWorkspaceAndId(
      controlPlaneWorkspaceId(scope),
      knowledgeIndexId,
    );
    if (index === null) {
      throw new KnowledgeIndexNotFoundError(knowledgeIndexId);
    }

    if (index.status !== "FAILED") {
      throw new KnowledgeIndexNotRetryableError(knowledgeIndexId, index.status);
    }

    const now = this.deps.clock.now();
    const retried = index.transitionTo("PENDING", {
      updatedAt: now,
      lastErrorCode: undefined,
      lastErrorMessage: undefined,
      leaseToken: null,
      leaseExpiresAt: null,
    });
    await this.deps.knowledge.updateIndex(retried);
    await this.deps.indexQueue.enqueue(retried.id);
    return retried;
  }
}

export class GetKnowledgeSource {
  constructor(private readonly deps: KnowledgeApplicationDependencies) {}

  async execute(
    scope: ControlPlaneScope,
    workspaceId: WorkspaceId,
    knowledgeSourceId: KnowledgeSourceId,
  ): Promise<KnowledgeSource> {
    requireControlPlaneAuthorization(
      scope,
      AUTHORIZATION_ACTIONS.READ,
      KNOWLEDGE_RESOURCE,
    );
    const source = await this.deps.knowledge.findSourceByWorkspaceAndId(
      controlPlaneWorkspaceId(scope),
      knowledgeSourceId,
    );
    if (source === null) {
      throw new KnowledgeSourceNotFoundError(knowledgeSourceId);
    }
    return source;
  }
}

export class GetKnowledgeIndex {
  constructor(private readonly deps: KnowledgeApplicationDependencies) {}

  async execute(
    scope: ControlPlaneScope,
    workspaceId: WorkspaceId,
    knowledgeIndexId: KnowledgeIndexId,
  ): Promise<KnowledgeIndex> {
    requireControlPlaneAuthorization(
      scope,
      AUTHORIZATION_ACTIONS.READ,
      KNOWLEDGE_RESOURCE,
    );
    const index = await this.deps.knowledge.findIndexByWorkspaceAndId(
      controlPlaneWorkspaceId(scope),
      knowledgeIndexId,
    );
    if (index === null) {
      throw new KnowledgeIndexNotFoundError(knowledgeIndexId);
    }
    return index;
  }
}

export class ListKnowledgeSources {
  constructor(private readonly deps: KnowledgeApplicationDependencies) {}

  async execute(
    scope: ControlPlaneScope,
    query: Omit<ListKnowledgeSourcesQuery, "limit" | "workspaceId"> & {
      readonly limit?: number;
      readonly workspaceId?: WorkspaceId;
    },
  ) {
    requireControlPlaneAuthorization(
      scope,
      AUTHORIZATION_ACTIONS.READ,
      KNOWLEDGE_RESOURCE,
    );
    const limit = clamp(
      query.limit ?? DEFAULT_KNOWLEDGE_SOURCE_LIST_LIMIT,
      MAX_KNOWLEDGE_SOURCE_LIST_LIMIT,
    );
    return this.deps.knowledge.listSources({
      ...query,
      workspaceId: controlPlaneWorkspaceId(scope),
      limit,
    });
  }
}

export class ListKnowledgeIndexes {
  constructor(private readonly deps: KnowledgeApplicationDependencies) {}

  async execute(
    scope: ControlPlaneScope,
    query: Omit<ListKnowledgeIndexesQuery, "limit" | "workspaceId"> & {
      readonly limit?: number;
      readonly workspaceId?: WorkspaceId;
    },
  ) {
    requireControlPlaneAuthorization(
      scope,
      AUTHORIZATION_ACTIONS.READ,
      KNOWLEDGE_RESOURCE,
    );
    const workspaceId = controlPlaneWorkspaceId(scope);
    const source = await this.deps.knowledge.findSourceByWorkspaceAndId(
      workspaceId,
      query.knowledgeSourceId,
    );
    if (source === null) {
      throw new KnowledgeSourceNotFoundError(query.knowledgeSourceId);
    }
    const limit = clamp(
      query.limit ?? DEFAULT_KNOWLEDGE_INDEX_LIST_LIMIT,
      MAX_KNOWLEDGE_INDEX_LIST_LIMIT,
    );
    return this.deps.knowledge.listIndexesBySource({
      ...query,
      workspaceId,
      limit,
    });
  }
}

export interface KnowledgeApplication {
  readonly createSource: CreateKnowledgeSource;
  readonly getSource: GetKnowledgeSource;
  readonly listSources: ListKnowledgeSources;
  readonly createIndex: CreateKnowledgeIndex;
  readonly getIndex: GetKnowledgeIndex;
  readonly listIndexes: ListKnowledgeIndexes;
  readonly retryIndex: RetryKnowledgeIndex;
}

export function createKnowledgeApplication(
  deps: KnowledgeApplicationDependencies,
): KnowledgeApplication {
  return {
    createSource: new CreateKnowledgeSource(deps),
    getSource: new GetKnowledgeSource(deps),
    listSources: new ListKnowledgeSources(deps),
    createIndex: new CreateKnowledgeIndex(deps),
    getIndex: new GetKnowledgeIndex(deps),
    listIndexes: new ListKnowledgeIndexes(deps),
    retryIndex: new RetryKnowledgeIndex(deps),
  };
}

function assertSourceReplay(
  existing: KnowledgeSource,
  command: CreateKnowledgeSourceCommand,
): void {
  if (
    existing.key !== command.key ||
    existing.name !== command.name ||
    existing.artifactId !== command.artifactId ||
    !jsonValuesEqual(existing.attributes, command.attributes ?? {})
  ) {
    throw new KnowledgeIdempotencyConflictError(
      command.workspaceId,
      command.idempotencyKey!,
    );
  }
}

function clamp(value: number, max: number): number {
  return Math.min(Math.max(1, value), max);
}
