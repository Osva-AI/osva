import type { KnowledgeChunkId, WorkspaceId } from "@osva/contracts";
import { createDatabase, migrateDatabase, type Database } from "@osva/db";
import { KnowledgeChunk, KnowledgeIndex, Workspace } from "@osva/domain";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  resetStage0Tables,
  startPostgresForTests,
  stopPostgresForTests,
  type PostgresTestContext,
} from "../../../../packages/db/test/integration/postgres-harness.js";
import {
  createKnowledgeIntegrationStack,
  integrationControlPlaneScope,
  uploadTextArtifact,
} from "./knowledge-stack.js";

const NOW = new Date("2026-02-01T12:00:00.000Z");
const LATER = new Date("2026-02-01T13:00:00.000Z");
const WORKSPACE_ID = "ws-knowledge-recovery" as WorkspaceId;

describe("knowledge ingestion recovery", () => {
  let postgres: PostgresTestContext;
  let database: Database;

  beforeAll(async () => {
    postgres = await startPostgresForTests();
    database = createDatabase({
      connectionString: postgres.connectionString,
      max: 5,
      connectTimeoutSeconds: 10,
    });
    await migrateDatabase(database);
  });

  afterAll(async () => {
    await database?.close();
    await stopPostgresForTests(postgres);
  });

  beforeEach(async () => {
    await resetStage0Tables(database);
  });

  async function seedReadyIndex() {
    const stack = await createKnowledgeIntegrationStack(database, { now: NOW });
    await stack.workspaces.save(
      Workspace.create({
        id: WORKSPACE_ID,
        name: "Recovery",
        createdAt: NOW,
      }),
    );
    const artifact = await uploadTextArtifact(
      stack,
      WORKSPACE_ID,
      "doc.txt",
      "Recovery document about widgets and refunds.",
    );
    const source = await stack.knowledgeApp.createSource.execute(
      integrationControlPlaneScope(WORKSPACE_ID),
      {
        workspaceId: WORKSPACE_ID,
        key: "doc",
        name: "Doc",
        artifactId: artifact.id,
      },
    );
    const index = await stack.knowledgeApp.createIndex.execute(
      integrationControlPlaneScope(WORKSPACE_ID),
      {
        workspaceId: WORKSPACE_ID,
        knowledgeSourceId: source.id,
      },
    );
    await stack.ingestion.processIndex(index.id);
    return { stack, index, source, artifact };
  }

  it("ignores duplicate delivery after READY without duplicating chunks or vectors", async () => {
    const { stack, index } = await seedReadyIndex();
    const beforeChunks = await stack.knowledge.listChunksByIndex(index.id);
    const beforeVectors = await stack.vectorStore.countForIndex(index.id);

    await stack.ingestion.processIndex(index.id);
    await stack.ingestion.processIndex(index.id);

    const after = await stack.knowledge.findIndexById(index.id);
    expect(after?.status).toBe("READY");
    expect(await stack.knowledge.listChunksByIndex(index.id)).toHaveLength(
      beforeChunks.length,
    );
    expect(await stack.vectorStore.countForIndex(index.id)).toBe(beforeVectors);
  });

  it("reuses persisted extraction instead of reparsing the source", async () => {
    const stack = await createKnowledgeIntegrationStack(database, { now: NOW });
    await stack.workspaces.save(
      Workspace.create({
        id: WORKSPACE_ID,
        name: "Recovery",
        createdAt: NOW,
      }),
    );
    const artifact = await uploadTextArtifact(
      stack,
      WORKSPACE_ID,
      "reuse.txt",
      "Reuse extraction content for ingestion recovery.",
    );
    const source = await stack.knowledgeApp.createSource.execute(
      integrationControlPlaneScope(WORKSPACE_ID),
      {
        workspaceId: WORKSPACE_ID,
        key: "reuse",
        name: "Reuse",
        artifactId: artifact.id,
      },
    );
    const index = await stack.knowledgeApp.createIndex.execute(
      integrationControlPlaneScope(WORKSPACE_ID),
      {
        workspaceId: WORKSPACE_ID,
        knowledgeSourceId: source.id,
      },
    );

    const openSpy = vi.spyOn(stack.artifacts.openArtifactContent, "execute");
    await stack.ingestion.processIndex(index.id);
    const ready = await stack.knowledge.findIndexById(index.id);
    expect(ready?.status).toBe("READY");
    const extractedId = ready!.extractedArtifactId!;
    const sourceOpensAfterReady = openSpy.mock.calls.filter(
      (call) => call[1] === artifact.id,
    ).length;

    openSpy.mockClear();
    await stack.knowledge.updateIndex(
      KnowledgeIndex.rehydrate({
        ...ready!,
        status: "FAILED",
        leaseToken: undefined,
        leaseExpiresAt: undefined,
        lastErrorCode: "KNOWLEDGE_UNAVAILABLE",
        lastErrorMessage: "injected",
        updatedAt: LATER,
      }),
    );
    const retried = await stack.knowledgeApp.retryIndex.execute(
      integrationControlPlaneScope(WORKSPACE_ID),
      WORKSPACE_ID,
      index.id,
    );
    expect(retried.status).toBe("PENDING");
    await stack.ingestion.processIndex(index.id);

    const sourceOpensOnRetry = openSpy.mock.calls.filter(
      (call) => call[1] === artifact.id,
    ).length;
    const extractionOpensOnRetry = openSpy.mock.calls.filter(
      (call) => call[1] === extractedId,
    ).length;
    expect(sourceOpensOnRetry).toBe(0);
    expect(extractionOpensOnRetry).toBeGreaterThan(0);
    expect(sourceOpensAfterReady).toBeGreaterThan(0);
    openSpy.mockRestore();
  });

  it("does not duplicate chunk ordinals on retry", async () => {
    const { stack, index } = await seedReadyIndex();
    const chunks = await stack.knowledge.listChunksByIndex(index.id);
    const ordinal = chunks[0]!.ordinal;
    await expect(
      stack.knowledge.saveChunk(
        KnowledgeChunk.create({
          id: "kc-dup" as KnowledgeChunkId,
          workspaceId: WORKSPACE_ID,
          knowledgeIndexId: index.id,
          ordinal,
          text: "duplicate",
          createdAt: NOW,
        }),
      ),
    ).rejects.toThrow();
  });

  it("reclaims stale RUNNING leases", async () => {
    const stack = await createKnowledgeIntegrationStack(database, { now: NOW });
    await stack.workspaces.save(
      Workspace.create({
        id: WORKSPACE_ID,
        name: "Lease",
        createdAt: NOW,
      }),
    );
    const artifact = await uploadTextArtifact(
      stack,
      WORKSPACE_ID,
      "lease.txt",
      "Lease reclaim document.",
    );
    const source = await stack.knowledgeApp.createSource.execute(
      integrationControlPlaneScope(WORKSPACE_ID),
      {
        workspaceId: WORKSPACE_ID,
        key: "lease",
        name: "Lease",
        artifactId: artifact.id,
      },
    );
    const index = await stack.knowledgeApp.createIndex.execute(
      integrationControlPlaneScope(WORKSPACE_ID),
      {
        workspaceId: WORKSPACE_ID,
        knowledgeSourceId: source.id,
      },
    );

    const firstClaim = await stack.knowledge.claimIndexLease({
      knowledgeIndexId: index.id,
      workspaceId: WORKSPACE_ID,
      leaseToken: "lease-1",
      leaseExpiresAt: new Date(NOW.getTime() + 1_000),
      now: NOW,
    });
    expect(firstClaim?.status).toBe("RUNNING");

    const reclaimed = await stack.knowledge.claimIndexLease({
      knowledgeIndexId: index.id,
      workspaceId: WORKSPACE_ID,
      leaseToken: "lease-2",
      leaseExpiresAt: new Date(LATER.getTime() + 60_000),
      now: LATER,
    });
    expect(reclaimed?.leaseToken).toBe("lease-2");
  });

  it("does not claim READY indexes for ingestion", async () => {
    const { stack, index } = await seedReadyIndex();
    const claimReady = await stack.knowledge.claimIndexLease({
      knowledgeIndexId: index.id,
      workspaceId: WORKSPACE_ID,
      leaseToken: "x",
      leaseExpiresAt: new Date(NOW.getTime() + 60_000),
      now: NOW,
    });
    expect(claimReady).toBeNull();
  });
});
