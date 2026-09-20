import type {
  ArtifactId,
  KnowledgeChunkId,
  KnowledgeIndexId,
  KnowledgeSourceId,
  WorkspaceId,
} from "@osva/contracts";
import {
  Artifact,
  KnowledgeChunk,
  KnowledgeIndex,
  KnowledgeSource,
  Workspace,
  computeKnowledgePipelineFingerprint,
  resolveDefaultKnowledgePipeline,
} from "@osva/domain";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createDatabase, type Database } from "../../src/database.js";
import { migrateDatabase } from "../../src/migrate.js";
import { PostgresArtifactRepository } from "../../src/repositories/postgres-artifact-repository.js";
import { PostgresKnowledgeRepository } from "../../src/repositories/postgres-knowledge-repository.js";
import { PostgresWorkspaceRepository } from "../../src/repositories/postgres-workspace-repository.js";
import { NOW, createIds } from "./fixtures.js";
import {
  resetStage0Tables,
  startPostgresForTests,
  stopPostgresForTests,
  type PostgresTestContext,
} from "./postgres-harness.js";

describe("PostgreSQL knowledge repository", () => {
  let context: PostgresTestContext;
  let database: Database;
  let workspaces: PostgresWorkspaceRepository;
  let knowledge: PostgresKnowledgeRepository;
  let artifacts: PostgresArtifactRepository;

  beforeAll(async () => {
    context = await startPostgresForTests();
    database = createDatabase({
      connectionString: context.connectionString,
      max: 5,
      connectTimeoutSeconds: 10,
    });
    await migrateDatabase(database);
    workspaces = new PostgresWorkspaceRepository(database);
    knowledge = new PostgresKnowledgeRepository(database);
    artifacts = new PostgresArtifactRepository(database);
  });

  async function saveStubArtifact(
    workspaceId: WorkspaceId,
    artifactId: ArtifactId,
  ): Promise<void> {
    await artifacts.save(
      Artifact.create({
        id: artifactId,
        workspaceId,
        name: "stub.txt",
        mediaType: "text/plain",
        sizeBytes: 4,
        digest: `sha256:${"a".repeat(64)}`,
        metadata: {},
        createdAt: NOW,
      }),
    );
  }

  async function saveSourceAndIndex(
    workspaceId: WorkspaceId,
    sourceId: KnowledgeSourceId,
    indexId: KnowledgeIndexId,
    artifactId: ArtifactId,
  ): Promise<void> {
    await saveStubArtifact(workspaceId, artifactId);
    const source = KnowledgeSource.create({
      id: sourceId,
      workspaceId,
      key: `key-${sourceId}`,
      name: "Source",
      artifactId,
      createdAt: NOW,
    });
    await knowledge.saveSource(source);
    const pipeline = resolveDefaultKnowledgePipeline({
      provider: "DETERMINISTIC",
      model: "test",
      dimensions: 8,
    });
    await knowledge.saveIndex(
      KnowledgeIndex.create({
        id: indexId,
        workspaceId,
        knowledgeSourceId: sourceId,
        ...pipeline,
        pipelineFingerprint: computeKnowledgePipelineFingerprint(pipeline),
        createdAt: NOW,
      }),
    );
  }

  afterAll(async () => {
    await database?.close();
    await stopPostgresForTests(context);
  });

  beforeEach(async () => {
    await resetStage0Tables(database);
  });

  it("persists sources with workspace-scoped keys and idempotency", async () => {
    const ids = createIds("knowledge-source");
    await workspaces.save(
      Workspace.create({
        id: ids.workspaceId,
        name: "Workspace",
        createdAt: NOW,
      }),
    );

    await saveStubArtifact(
      ids.workspaceId as WorkspaceId,
      "artifact-1" as ArtifactId,
    );
    const source = KnowledgeSource.create({
      id: "ks-1" as KnowledgeSourceId,
      workspaceId: ids.workspaceId as WorkspaceId,
      key: "handbook",
      name: "Handbook",
      artifactId: "artifact-1" as ArtifactId,
      attributes: { department: "finance" },
      idempotencyKey: "idem-1",
      createdAt: NOW,
    });
    await knowledge.saveSource(source);

    const loaded = await knowledge.findSourceByWorkspaceKey(
      ids.workspaceId as WorkspaceId,
      "handbook",
    );
    expect(loaded?.id).toBe("ks-1");

    const byIdempotency = await knowledge.findSourceByWorkspaceIdempotencyKey(
      ids.workspaceId as WorkspaceId,
      "idem-1",
    );
    expect(byIdempotency?.id).toBe("ks-1");
  });

  it("claims index leases exclusively and recovers stale RUNNING leases", async () => {
    const ids = createIds("knowledge-claim");
    await workspaces.save(
      Workspace.create({
        id: ids.workspaceId,
        name: "Workspace",
        createdAt: NOW,
      }),
    );

    await saveSourceAndIndex(
      ids.workspaceId as WorkspaceId,
      "ks-claim" as KnowledgeSourceId,
      "ki-claim" as KnowledgeIndexId,
      "artifact-claim" as ArtifactId,
    );
    const index = await knowledge.findIndexById("ki-claim" as KnowledgeIndexId);
    if (index === null) {
      throw new Error("Expected knowledge index.");
    }

    const claimed = await knowledge.claimIndexLease({
      knowledgeIndexId: index.id,
      workspaceId: index.workspaceId,
      leaseToken: "lease-a",
      leaseExpiresAt: new Date(NOW.getTime() + 60_000),
      now: NOW,
    });
    expect(claimed?.status).toBe("RUNNING");
    expect(claimed?.leaseToken).toBe("lease-a");

    const duplicateClaim = await knowledge.claimIndexLease({
      knowledgeIndexId: index.id,
      workspaceId: index.workspaceId,
      leaseToken: "lease-b",
      leaseExpiresAt: new Date(NOW.getTime() + 60_000),
      now: NOW,
    });
    expect(duplicateClaim).toBeNull();

    const staleClaim = await knowledge.claimIndexLease({
      knowledgeIndexId: index.id,
      workspaceId: index.workspaceId,
      leaseToken: "lease-c",
      leaseExpiresAt: new Date(NOW.getTime() + 60_000),
      now: new Date(NOW.getTime() + 120_000),
    });
    expect(staleClaim?.leaseToken).toBe("lease-c");
  });

  it("enforces unique chunk ordinals per index", async () => {
    const ids = createIds("knowledge-chunk");
    await workspaces.save(
      Workspace.create({
        id: ids.workspaceId,
        name: "Workspace",
        createdAt: NOW,
      }),
    );

    await saveSourceAndIndex(
      ids.workspaceId as WorkspaceId,
      "ks-chunk" as KnowledgeSourceId,
      "ki-1" as KnowledgeIndexId,
      "artifact-chunk" as ArtifactId,
    );

    const chunk = KnowledgeChunk.create({
      id: "kc-1" as KnowledgeChunkId,
      workspaceId: ids.workspaceId as WorkspaceId,
      knowledgeIndexId: "ki-1" as KnowledgeIndexId,
      ordinal: 0,
      text: "hello",
      createdAt: NOW,
    });
    await knowledge.saveChunk(chunk);

    const duplicate = KnowledgeChunk.create({
      id: "kc-2" as KnowledgeChunkId,
      workspaceId: ids.workspaceId as WorkspaceId,
      knowledgeIndexId: "ki-1" as KnowledgeIndexId,
      ordinal: 0,
      text: "other",
      createdAt: NOW,
    });
    await expect(knowledge.saveChunk(duplicate)).rejects.toThrow();
  });
});
