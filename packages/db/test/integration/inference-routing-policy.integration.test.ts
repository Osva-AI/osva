import type { InferenceRoutingPolicyId, WorkspaceId } from "@osva-ai/contracts";
import {
  createDatabase,
  migrateDatabase,
  PostgresInferenceRoutingPolicyRepository,
  PostgresWorkspaceRepository,
  type Database,
} from "../../src/index.js";
import { Workspace } from "@osva/domain";
import { describe, expect, it, beforeAll, afterAll, beforeEach } from "vitest";

import {
  resetStage0Tables,
  startPostgresForTests,
  stopPostgresForTests,
  type PostgresTestContext,
} from "./postgres-harness.js";

const workspaceId = "ws-routing-policy" as WorkspaceId;

describe("inference routing policy (0043)", () => {
  let postgres: PostgresTestContext;
  let database: Database;
  let repo: PostgresInferenceRoutingPolicyRepository;
  let workspaces: PostgresWorkspaceRepository;

  beforeAll(async () => {
    postgres = await startPostgresForTests();
    database = createDatabase({
      connectionString: postgres.connectionString,
      max: 3,
      connectTimeoutSeconds: 10,
    });
    await migrateDatabase(database);
    repo = new PostgresInferenceRoutingPolicyRepository(database);
    workspaces = new PostgresWorkspaceRepository(database);
  });

  beforeEach(async () => {
    await resetStage0Tables(database);
    await workspaces.save(
      Workspace.create({
        id: workspaceId,
        name: "Routing",
        createdAt: new Date("2026-02-01T00:00:00.000Z"),
      }),
    );
  });

  afterAll(async () => {
    await database.close();
    await stopPostgresForTests(postgres);
  });

  it("stores immutable versioned policy and runtime activation", async () => {
    const policyId = "irp-1" as InferenceRoutingPolicyId;
    const versionId =
      "irpv-1" as import("@osva-ai/contracts").InferenceRoutingPolicyVersionId;
    const now = new Date("2026-02-01T00:00:00.000Z");

    await repo.savePolicy({
      id: policyId,
      workspaceId,
      key: "default",
      createdAt: now,
    });
    await repo.savePolicyVersion({
      id: versionId,
      policyId,
      workspaceId,
      version: 1,
      definition: {
        schemaVersion: "1",
        strategy: "FIXED",
        candidateModelProfileVersionIds: [
          "mpv-1" as import("@osva-ai/contracts").ModelProfileVersionId,
        ],
        preferredModelProfileVersionId:
          "mpv-1" as import("@osva-ai/contracts").ModelProfileVersionId,
      },
      createdAt: now,
    });

    const disabled = await repo.findRuntimePolicyByWorkspaceId(workspaceId);
    expect(disabled).toBeNull();

    await repo.upsertWorkspaceActivation({
      workspaceId,
      enabled: true,
      activePolicyVersionId: versionId,
      updatedAt: now,
    });

    const runtime = await repo.findRuntimePolicyByWorkspaceId(workspaceId);
    expect(runtime?.enabled).toBe(true);
    expect(runtime?.definition?.strategy).toBe("FIXED");
    expect(runtime?.policyVersionId).toBe(versionId);
  });
});
