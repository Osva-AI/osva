import type {
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
import { createDatabase, migrateDatabase, type Database } from "@osva/db";
import {
  PostgresArtifactRepository,
  PostgresKnowledgeRepository,
  PostgresWorkspaceRepository,
} from "@osva/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { PgVectorStore } from "../../src/pgvector-store.js";
import {
  resetStage0Tables,
  startPostgresForTests,
  stopPostgresForTests,
  type PostgresTestContext,
} from "../../../../packages/db/test/integration/postgres-harness.js";

const NOW = new Date("2026-01-15T12:00:00.000Z");

function unitVector(dimensions: number, index: number): readonly number[] {
  const values = Array.from({ length: dimensions }, () => 0);
  values[index] = 1;
  return values;
}

describe("PgVectorStore integration", () => {
  let context: PostgresTestContext;
  let database: Database;
  let vectorStore: PgVectorStore;
  let knowledge: PostgresKnowledgeRepository;
  let workspaces: PostgresWorkspaceRepository;

  const workspaceId = "ws-pgvector" as WorkspaceId;
  const sourceId = "ks-pgvector" as KnowledgeSourceId;
  const indexId = "ki-pgvector" as KnowledgeIndexId;

  beforeAll(async () => {
    context = await startPostgresForTests();
    database = createDatabase({
      connectionString: context.connectionString,
      max: 5,
      connectTimeoutSeconds: 10,
    });
    await migrateDatabase(database);
    vectorStore = new PgVectorStore(database);
    knowledge = new PostgresKnowledgeRepository(database);
    workspaces = new PostgresWorkspaceRepository(database);
  });

  afterAll(async () => {
    await database?.close();
    await stopPostgresForTests(context);
  });

  beforeEach(async () => {
    await resetStage0Tables(database);
    await workspaces.save(
      Workspace.create({
        id: workspaceId,
        name: "Workspace",
        createdAt: NOW,
      }),
    );

    const pipeline = resolveDefaultKnowledgePipeline({
      provider: "DETERMINISTIC",
      model: "test",
      dimensions: 4,
    });
    const artifacts = new PostgresArtifactRepository(database);
    await artifacts.save(
      Artifact.create({
        id: "artifact-1" as never,
        workspaceId,
        name: "stub.txt",
        mediaType: "text/plain",
        sizeBytes: 4,
        digest: `sha256:${"a".repeat(64)}`,
        metadata: {},
        createdAt: NOW,
      }),
    );
    await knowledge.saveSource(
      KnowledgeSource.create({
        id: sourceId,
        workspaceId,
        key: "docs",
        name: "Docs",
        artifactId: "artifact-1" as never,
        attributes: { department: "finance" },
        createdAt: NOW,
      }),
    );
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

    for (let ordinal = 0; ordinal < 3; ordinal += 1) {
      await knowledge.saveChunk(
        KnowledgeChunk.create({
          id: `kc-${String(ordinal)}` as KnowledgeChunkId,
          workspaceId,
          knowledgeIndexId: indexId,
          ordinal,
          text: `chunk-${String(ordinal)}`,
          createdAt: NOW,
        }),
      );
    }

    await vectorStore.upsert([
      {
        workspaceId,
        knowledgeIndexId: indexId,
        knowledgeChunkId: "kc-0" as KnowledgeChunkId,
        embedding: unitVector(4, 0),
      },
      {
        workspaceId,
        knowledgeIndexId: indexId,
        knowledgeChunkId: "kc-1" as KnowledgeChunkId,
        embedding: unitVector(4, 1),
      },
      {
        workspaceId,
        knowledgeIndexId: indexId,
        knowledgeChunkId: "kc-2" as KnowledgeChunkId,
        embedding: unitVector(4, 2),
      },
    ]);
  });

  it("orders matches by cosine distance and filters source attributes", async () => {
    const matches = await vectorStore.query({
      workspaceId,
      knowledgeIndexIds: [indexId],
      queryVector: unitVector(4, 1),
      topK: 2,
      filter: { department: "finance" },
    });
    expect(matches).toHaveLength(2);
    expect(matches[0]?.knowledgeChunkId).toBe("kc-1");
    expect(matches[0]?.distance).toBeCloseTo(0, 5);

    const filteredOut = await vectorStore.query({
      workspaceId,
      knowledgeIndexIds: [indexId],
      queryVector: unitVector(4, 1),
      topK: 5,
      filter: { department: "legal" },
    });
    expect(filteredOut).toHaveLength(0);
  });

  it("queries with the same embedding dimension as stored vectors", async () => {
    const matches = await vectorStore.query({
      workspaceId,
      knowledgeIndexIds: [indexId],
      queryVector: unitVector(4, 0),
      topK: 1,
    });
    expect(matches).toHaveLength(1);
  });

  it("rejects query vectors with mismatched dimensions", async () => {
    await expect(
      vectorStore.query({
        workspaceId,
        knowledgeIndexIds: [indexId],
        queryVector: unitVector(8, 0),
        topK: 1,
      }),
    ).rejects.toThrow();
  });

  it("upserts vectors idempotently by chunk id", async () => {
    await vectorStore.upsert([
      {
        workspaceId,
        knowledgeIndexId: indexId,
        knowledgeChunkId: "kc-0" as KnowledgeChunkId,
        embedding: unitVector(4, 3),
      },
    ]);
    const count = await vectorStore.countForIndex(indexId);
    expect(count).toBe(3);
  });
});
