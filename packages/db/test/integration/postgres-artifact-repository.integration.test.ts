import type { ArtifactId, WorkspaceId } from "@osva/contracts";
import { Artifact, Workspace } from "@osva/domain";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createDatabase, type Database } from "../../src/database.js";
import { migrateDatabase } from "../../src/migrate.js";
import { PostgresArtifactRepository } from "../../src/repositories/postgres-artifact-repository.js";
import { PostgresWorkspaceRepository } from "../../src/repositories/postgres-workspace-repository.js";
import { NOW, createIds } from "./fixtures.js";
import {
  resetStage0Tables,
  startPostgresForTests,
  stopPostgresForTests,
  type PostgresTestContext,
} from "./postgres-harness.js";

describe("PostgreSQL artifact repository", () => {
  let context: PostgresTestContext;
  let database: Database;
  let workspaces: PostgresWorkspaceRepository;
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
    artifacts = new PostgresArtifactRepository(database);
  });

  afterAll(async () => {
    await database?.close();
    await stopPostgresForTests(context);
  });

  beforeEach(async () => {
    await resetStage0Tables(database);
  });

  it("persists and lists artifacts by workspace", async () => {
    const ids = createIds("artifact");
    await workspaces.save(
      Workspace.create({
        id: ids.workspaceId,
        name: "Workspace",
        createdAt: NOW,
      }),
    );

    const artifact = Artifact.create({
      id: "artifact-1" as ArtifactId,
      workspaceId: ids.workspaceId as WorkspaceId,
      name: "a.txt",
      mediaType: "text/plain",
      sizeBytes: 3,
      digest: `sha256:${"c".repeat(64)}`,
      metadata: { source: "test" },
      createdAt: NOW,
    });

    await artifacts.save(artifact);
    const loaded = await artifacts.findById("artifact-1" as ArtifactId);
    expect(loaded?.name).toBe("a.txt");

    const page = await artifacts.list({
      workspaceId: ids.workspaceId as WorkspaceId,
      limit: 10,
    });
    expect(page.artifacts).toHaveLength(1);
  });
});
