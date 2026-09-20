import { text } from "node:stream/consumers";
import type { WorkspaceId } from "@osva/contracts";
import { KNOWLEDGE_EXTRACTION_MEDIA_TYPE } from "@osva/contracts";
import { createDatabase, migrateDatabase, type Database } from "@osva/db";
import { Workspace } from "@osva/domain";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  resetStage0Tables,
  startPostgresForTests,
  stopPostgresForTests,
  type PostgresTestContext,
} from "../../../../packages/db/test/integration/postgres-harness.js";
import {
  createKnowledgeIntegrationStack,
  TEST_EMBEDDING_DEFAULTS,
  uploadTextArtifact,
} from "./knowledge-stack.js";

const NOW = new Date("2026-02-01T12:00:00.000Z");
const WORKSPACE_ID = "ws-knowledge-e2e" as WorkspaceId;

const SOURCE_BODY = [
  "Company handbook",
  "",
  "The refund policy allows returns within thirty days of purchase.",
  "Contact finance for billing questions.",
].join("\n");

describe("knowledge ingestion end-to-end", () => {
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

  it("indexes source artifact through READY and retrieves canonical chunks", async () => {
    const stack = await createKnowledgeIntegrationStack(database, { now: NOW });
    await stack.workspaces.save(
      Workspace.create({
        id: WORKSPACE_ID,
        name: "Knowledge E2E",
        createdAt: NOW,
      }),
    );

    const sourceArtifact = await uploadTextArtifact(
      stack,
      WORKSPACE_ID,
      "handbook.txt",
      SOURCE_BODY,
    );

    const source = await stack.knowledgeApp.createSource.execute({
      workspaceId: WORKSPACE_ID,
      key: "handbook",
      name: "Handbook",
      artifactId: sourceArtifact.id,
      attributes: { department: "finance" },
    });
    expect(source.artifactId).toBe(sourceArtifact.id);

    const index = await stack.knowledgeApp.createIndex.execute({
      workspaceId: WORKSPACE_ID,
      knowledgeSourceId: source.id,
    });
    expect(index.status).toBe("PENDING");

    await stack.ingestion.processIndex(index.id);

    const ready = await stack.knowledge.findIndexById(index.id);
    expect(ready?.status).toBe("READY");
    expect(ready?.extractedArtifactId).toBeDefined();
    expect(ready?.chunkCount).toBeGreaterThan(0);
    expect(ready?.embeddedChunkCount).toBe(ready?.chunkCount);

    const extracted = await stack.artifacts.openArtifactContent.execute(
      ready!.extractedArtifactId!,
    );
    expect(extracted.artifact.mediaType).toBe(KNOWLEDGE_EXTRACTION_MEDIA_TYPE);
    const extractionBody = await text(extracted.content.stream);
    expect(extractionBody).toContain("refund policy");

    const chunks = await stack.knowledge.listChunksByIndex(index.id);
    expect(chunks.length).toBe(ready?.chunkCount);
    const ordinals = chunks.map((chunk) => chunk.ordinal);
    expect(ordinals).toEqual([...ordinals].sort((a, b) => a - b));
    expect(new Set(ordinals).size).toBe(ordinals.length);

    const vectorCount = await stack.vectorStore.countForIndex(index.id);
    expect(vectorCount).toBe(chunks.length);

    const refundChunk = chunks.find((chunk) =>
      chunk.text.includes("refund policy"),
    );
    expect(refundChunk).toBeDefined();

    const hits = await stack.retriever.retrieve({
      workspaceId: WORKSPACE_ID,
      knowledgeIndexIds: [index.id],
      query: refundChunk!.text,
      topK: 3,
    });
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]?.text).toBe(refundChunk!.text);
    expect(hits[0]?.knowledgeChunkId).toBe(refundChunk!.id);
    expect(hits[0]?.knowledgeIndexId).toBe(index.id);
    expect(hits[0]?.knowledgeSourceId).toBe(source.id);
    expect(hits[0]?.artifactReference.artifactId).toBe(sourceArtifact.id);
    expect(hits[0]?.artifactReference.artifactId).not.toBe(
      ready!.extractedArtifactId,
    );
    expect(hits[0]?.attributes).toEqual({ department: "finance" });

    const unchangedSource = await stack.artifacts.getArtifact.execute(
      sourceArtifact.id,
    );
    expect(unchangedSource.digest).toBe(sourceArtifact.digest);
    expect(unchangedSource.sizeBytes).toBe(sourceArtifact.sizeBytes);
    expect(ready?.embeddingProvider).toBe(TEST_EMBEDDING_DEFAULTS.provider);
  });
});
