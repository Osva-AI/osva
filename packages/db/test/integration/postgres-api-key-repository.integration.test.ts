import type { ApiKeyId, WorkspaceId } from "@osva/contracts";
import { COMMUNITY_EDITION_ROLES } from "@osva/contracts";
import {
  AuthenticateApiKey,
  CreateApiKey,
  DuplicateApiKeyIdError,
  Workspace,
  verifyApiKeySecret,
  generateApiKeySecretMaterial,
} from "@osva/domain";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createDatabase, type Database } from "../../src/database.js";
import { migrateDatabase } from "../../src/migrate.js";
import { PostgresApiKeyRepository } from "../../src/repositories/postgres-api-key-repository.js";
import { PostgresWorkspaceRepository } from "../../src/repositories/postgres-workspace-repository.js";
import { NOW } from "./fixtures.js";
import {
  resetStage0Tables,
  startPostgresForTests,
  stopPostgresForTests,
  type PostgresTestContext,
} from "./postgres-harness.js";

describe("PostgreSQL api key repository", () => {
  let context: PostgresTestContext;
  let database: Database;
  let workspaces: PostgresWorkspaceRepository;
  let apiKeys: PostgresApiKeyRepository;

  beforeAll(async () => {
    context = await startPostgresForTests();
    database = createDatabase({
      connectionString: context.connectionString,
      max: 5,
      connectTimeoutSeconds: 10,
    });
    await migrateDatabase(database);
    workspaces = new PostgresWorkspaceRepository(database);
    apiKeys = new PostgresApiKeyRepository(database);
  });

  afterAll(async () => {
    if (database) {
      await database.close();
    }
    if (context) {
      await stopPostgresForTests(context);
    }
  });

  beforeEach(async () => {
    await resetStage0Tables(database);
  });

  it("inserts credentials once and preserves verification material on duplicate create", async () => {
    const workspaceId = "ws-api-key" as WorkspaceId;
    await workspaces.save(
      Workspace.create({
        id: workspaceId,
        name: "Workspace",
        createdAt: NOW,
      }),
    );

    const createApiKey = new CreateApiKey({
      apiKeys,
      workspaces,
      clock: { now: () => NOW },
      ids: { createId: () => "ak-persisted" },
    });
    const created = await createApiKey.execute({
      workspaceId,
      name: "admin",
      role: COMMUNITY_EDITION_ROLES.ADMIN,
    });

    const loaded = await apiKeys.findById("ak-persisted" as ApiKeyId);
    expect(loaded).not.toBeNull();
    expect(loaded!.apiKey.workspaceId).toBe(workspaceId);
    expect(loaded!.secretDigest.length).toBe(32);
    expect(
      verifyApiKeySecret(
        created.plaintextToken.split(".")[1]!,
        loaded!.secretDigest,
      ),
    ).toBe(true);

    const replacement = generateApiKeySecretMaterial(
      "ak-persisted" as ApiKeyId,
    );
    await expect(
      apiKeys.create({
        apiKey: loaded!.apiKey,
        secretDigest: replacement.secretDigest,
      }),
    ).rejects.toBeInstanceOf(DuplicateApiKeyIdError);

    const unchanged = await apiKeys.findById("ak-persisted" as ApiKeyId);
    expect(unchanged!.secretDigest.equals(loaded!.secretDigest)).toBe(true);
  });

  it("revokes explicitly and prevents authentication afterward", async () => {
    const workspaceId = "ws-revoke" as WorkspaceId;
    await workspaces.save(
      Workspace.create({
        id: workspaceId,
        name: "Workspace",
        createdAt: NOW,
      }),
    );

    const createApiKey = new CreateApiKey({
      apiKeys,
      workspaces,
      clock: { now: () => NOW },
      ids: { createId: () => "ak-revoke" },
    });
    const created = await createApiKey.execute({
      workspaceId,
      name: "admin",
      role: COMMUNITY_EDITION_ROLES.ADMIN,
    });

    await apiKeys.revoke("ak-revoke" as ApiKeyId, NOW);
    const revoked = await apiKeys.findById("ak-revoke" as ApiKeyId);
    expect(revoked!.apiKey.revokedAt).toEqual(NOW);

    const authenticator = new AuthenticateApiKey({
      apiKeys,
      clock: { now: () => NOW },
    });
    expect(await authenticator.execute(created.plaintextToken)).toBeNull();
  });

  it("returns null for unknown identifiers", async () => {
    expect(await apiKeys.findById("missing" as ApiKeyId)).toBeNull();
  });
});
