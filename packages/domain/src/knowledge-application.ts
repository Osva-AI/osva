import type {
  ArtifactId,
  JsonObject,
  KnowledgeIndexId,
  KnowledgeSourceId,
  WorkspaceId,
} from "@osva/contracts";

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
    command: CreateKnowledgeSourceCommand,
  ): Promise<KnowledgeSource> {
    const workspace = await this.deps.workspaces.findById(command.workspaceId);
    if (workspace === null) {
      throw new WorkspaceNotFoundError(command.workspaceId);
    }

    const artifact = await this.deps.artifacts.findById(command.artifactId);
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
      workspaceId: command.workspaceId,
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

  async execute(command: CreateKnowledgeIndexCommand): Promise<KnowledgeIndex> {
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
      workspaceId: command.workspaceId,
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
    workspaceId: WorkspaceId,
    knowledgeIndexId: KnowledgeIndexId,
  ): Promise<KnowledgeIndex> {
    const index = await this.deps.knowledge.findIndexById(knowledgeIndexId);
    if (index === null || index.workspaceId !== workspaceId) {
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
    workspaceId: WorkspaceId,
    knowledgeSourceId: KnowledgeSourceId,
  ): Promise<KnowledgeSource> {
    const source = await this.deps.knowledge.findSourceById(knowledgeSourceId);
    if (source === null || source.workspaceId !== workspaceId) {
      throw new KnowledgeSourceNotFoundError(knowledgeSourceId);
    }
    return source;
  }
}

export class GetKnowledgeIndex {
  constructor(private readonly deps: KnowledgeApplicationDependencies) {}

  async execute(
    workspaceId: WorkspaceId,
    knowledgeIndexId: KnowledgeIndexId,
  ): Promise<KnowledgeIndex> {
    const index = await this.deps.knowledge.findIndexById(knowledgeIndexId);
    if (index === null || index.workspaceId !== workspaceId) {
      throw new KnowledgeIndexNotFoundError(knowledgeIndexId);
    }
    return index;
  }
}

export class ListKnowledgeSources {
  constructor(private readonly deps: KnowledgeApplicationDependencies) {}

  async execute(
    query: Omit<ListKnowledgeSourcesQuery, "limit"> & {
      readonly limit?: number;
    },
  ) {
    const limit = clamp(
      query.limit ?? DEFAULT_KNOWLEDGE_SOURCE_LIST_LIMIT,
      MAX_KNOWLEDGE_SOURCE_LIST_LIMIT,
    );
    return this.deps.knowledge.listSources({ ...query, limit });
  }
}

export class ListKnowledgeIndexes {
  constructor(private readonly deps: KnowledgeApplicationDependencies) {}

  async execute(
    query: Omit<ListKnowledgeIndexesQuery, "limit"> & {
      readonly limit?: number;
    },
  ) {
    const limit = clamp(
      query.limit ?? DEFAULT_KNOWLEDGE_INDEX_LIST_LIMIT,
      MAX_KNOWLEDGE_INDEX_LIST_LIMIT,
    );
    return this.deps.knowledge.listIndexesBySource({ ...query, limit });
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
