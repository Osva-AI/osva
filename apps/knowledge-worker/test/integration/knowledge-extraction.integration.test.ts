import { text } from "node:stream/consumers";
import type { WorkspaceId } from "@osva/contracts";
import { KNOWLEDGE_EXTRACTION_MEDIA_TYPE } from "@osva/contracts";
import { createDatabase, migrateDatabase, type Database } from "@osva/db";
import { Workspace } from "@osva/domain";
import type { VectorStore } from "@osva/domain";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

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
const WORKSPACE_ID = "ws-knowledge-extract" as WorkspaceId;

const PLAIN_BODY = "Alpha line one.\n\nBeta line two with details.\n";

describe("knowledge extraction artifact integration", () => {
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

  it("persists deterministic NDJSON extraction readable through Artifact storage", async () => {
    const failingVector: VectorStore = {
      upsert: async () => {
        throw new Error("vector upsert blocked for extraction-only test");
      },
      query: async () => [],
      countForIndex: async () => 0,
    };

    const stack = await createKnowledgeIntegrationStack(database, {
      now: NOW,
      vectorStore: failingVector as never,
    });
    await stack.workspaces.save(
      Workspace.create({
        id: WORKSPACE_ID,
        name: "Extract",
        createdAt: NOW,
      }),
    );

    const sourceArtifact = await uploadTextArtifact(
      stack,
      WORKSPACE_ID,
      "notes.txt",
      PLAIN_BODY,
    );
    const source = await stack.knowledgeApp.createSource.execute(
      integrationControlPlaneScope(WORKSPACE_ID),
      {
        workspaceId: WORKSPACE_ID,
        key: "notes",
        name: "Notes",
        artifactId: sourceArtifact.id,
      },
    );
    const index = await stack.knowledgeApp.createIndex.execute(
      integrationControlPlaneScope(WORKSPACE_ID),
      {
        workspaceId: WORKSPACE_ID,
        knowledgeSourceId: source.id,
      },
    );

    await expect(stack.ingestion.processIndex(index.id)).rejects.toThrow();

    const failed = await stack.knowledge.findIndexById(index.id);
    expect(failed?.extractedArtifactId).toBeDefined();

    const extractedId = failed!.extractedArtifactId!;
    const opened = await stack.artifacts.openArtifactContent.execute(
      integrationControlPlaneScope(WORKSPACE_ID),
      extractedId,
    );
    expect(opened.artifact.mediaType).toBe(KNOWLEDGE_EXTRACTION_MEDIA_TYPE);
    expect(opened.artifact.digest).toMatch(/^sha256:[0-9a-f]{64}$/);

    const raw = await text(opened.content.stream);
    const lines = raw
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    expect(lines.length).toBeGreaterThan(0);

    const first = JSON.parse(lines[0]!) as {
      ordinal: number;
      text: string;
      sourceSegmentOrdinal?: number;
    };
    expect(first.ordinal).toBe(1);
    expect(first.text).toContain("Alpha");
    expect(first.sourceSegmentOrdinal).toBe(1);

    const unchanged = await stack.artifacts.getArtifact.execute(
      integrationControlPlaneScope(WORKSPACE_ID),
      sourceArtifact.id,
    );
    expect(unchanged.digest).toBe(sourceArtifact.digest);
    expect(unchanged.sizeBytes).toBe(sourceArtifact.sizeBytes);
  });
});
