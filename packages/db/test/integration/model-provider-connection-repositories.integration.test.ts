import type {
  ModelProfileId,
  ModelProfileVersionId,
  ModelProviderConnectionId,
  ModelProviderConnectionVersionId,
  WorkspaceId,
} from "@osva-ai/contracts";
import {
  DomainInvariantError,
  DuplicateModelProviderConnectionKeyError,
  ModelProfile,
  ModelProviderConnection,
  ModelProviderConnectionVersion,
  Workspace,
} from "@osva/domain";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createDatabase, type Database } from "../../src/database.js";
import { migrateDatabase } from "../../src/migrate.js";
import { PostgresModelProfileRepository } from "../../src/repositories/postgres-model-profile-repository.js";
import { PostgresModelProviderConnectionRepository } from "../../src/repositories/postgres-model-provider-connection-repository.js";
import { PostgresWorkspaceRepository } from "../../src/repositories/postgres-workspace-repository.js";
import { modelProviderConnectionVersions } from "../../src/schema/model-provider-connection-versions.js";
import { NOW } from "./fixtures.js";
import {
  resetStage0Tables,
  startPostgresForTests,
  stopPostgresForTests,
  type PostgresTestContext,
} from "./postgres-harness.js";

describe("PostgreSQL model provider connection repository", () => {
  let context: PostgresTestContext;
  let database: Database;
  let workspaces: PostgresWorkspaceRepository;
  let connections: PostgresModelProviderConnectionRepository;
  let modelProfiles: PostgresModelProfileRepository;

  beforeAll(async () => {
    context = await startPostgresForTests();
    database = createDatabase({
      connectionString: context.connectionString,
      max: 5,
      connectTimeoutSeconds: 10,
    });
    await migrateDatabase(database);
    workspaces = new PostgresWorkspaceRepository(database);
    connections = new PostgresModelProviderConnectionRepository(database);
    modelProfiles = new PostgresModelProfileRepository(database);
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

  it("persists connections and immutable connection versions", async () => {
    const workspaceId = "workspace-mpc-1" as WorkspaceId;
    await seedWorkspace(workspaceId);

    const connection = ModelProviderConnection.create({
      id: "mpc-1" as ModelProviderConnectionId,
      workspaceId,
      key: "openai-local",
      name: "Local OpenAI",
      provider: "OPENAI",
      createdAt: NOW,
      updatedAt: NOW,
    });
    await connections.saveConnection(connection);

    const version = await connections.appendConnectionVersion({
      id: "mpcv-1" as ModelProviderConnectionVersionId,
      connectionId: connection.id,
      endpoint: {
        baseUrl: "http://127.0.0.1:8080/v1",
        allowPrivateNetworks: true,
      },
      credentialRef: { key: "OPENAI_API_KEY" },
      createdAt: NOW,
    });

    const loadedConnection = await connections.findConnectionByWorkspaceAndId(
      workspaceId,
      connection.id,
    );
    const loadedVersion = await connections.findConnectionVersionById(
      version.id,
    );
    const listed = await connections.listConnectionVersions(connection.id);

    expect(loadedConnection).toMatchObject({
      id: connection.id,
      workspaceId,
      key: "openai-local",
      provider: "OPENAI",
    });
    expect(loadedVersion).toMatchObject({
      id: version.id,
      connectionId: connection.id,
      version: 1,
      endpoint: {
        baseUrl: "http://127.0.0.1:8080/v1",
        allowPrivateNetworks: true,
      },
      credentialRef: { key: "OPENAI_API_KEY" },
    });
    expect(listed).toHaveLength(1);

    const [rawCredentialRow] = await database.db
      .select({ credentialRef: modelProviderConnectionVersions.credentialRef })
      .from(modelProviderConnectionVersions)
      .where(eq(modelProviderConnectionVersions.id, version.id))
      .limit(1);
    expect(JSON.stringify(rawCredentialRow?.credentialRef)).toContain(
      "OPENAI_API_KEY",
    );
    expect(JSON.stringify(rawCredentialRow?.credentialRef)).not.toContain(
      "sk-live-secret",
    );
  });

  it("rejects duplicate connection keys within a workspace", async () => {
    const workspaceId = "workspace-mpc-dup" as WorkspaceId;
    await seedWorkspace(workspaceId);

    await connections.saveConnection(
      ModelProviderConnection.create({
        id: "mpc-dup-a" as ModelProviderConnectionId,
        workspaceId,
        key: "shared",
        name: "A",
        provider: "OPENAI",
        createdAt: NOW,
        updatedAt: NOW,
      }),
    );

    await expect(
      connections.saveConnection(
        ModelProviderConnection.create({
          id: "mpc-dup-b" as ModelProviderConnectionId,
          workspaceId,
          key: "shared",
          name: "B",
          provider: "OPENAI",
          createdAt: NOW,
          updatedAt: NOW,
        }),
      ),
    ).rejects.toBeInstanceOf(DuplicateModelProviderConnectionKeyError);
  });

  it("appends monotonic version numbers and rejects immutable replacement", async () => {
    const workspaceId = "workspace-mpc-immutable" as WorkspaceId;
    await seedWorkspace(workspaceId);

    const connection = ModelProviderConnection.create({
      id: "mpc-immutable" as ModelProviderConnectionId,
      workspaceId,
      key: "immutable",
      name: "Immutable",
      provider: "OPENAI",
      createdAt: NOW,
      updatedAt: NOW,
    });
    await connections.saveConnection(connection);

    const first = await connections.appendConnectionVersion({
      id: "mpcv-immutable-1" as ModelProviderConnectionVersionId,
      connectionId: connection.id,
      createdAt: NOW,
    });
    const second = await connections.appendConnectionVersion({
      id: "mpcv-immutable-2" as ModelProviderConnectionVersionId,
      connectionId: connection.id,
      createdAt: NOW,
    });

    expect(first.version).toBe(1);
    expect(second.version).toBe(2);

    await expect(
      connections.saveConnectionVersion(
        ModelProviderConnectionVersion.create({
          id: first.id,
          connectionId: connection.id,
          version: first.version,
          endpoint: { baseUrl: "https://example.com/v1" },
          createdAt: NOW,
        }),
      ),
    ).rejects.toBeInstanceOf(DomainInvariantError);
  });

  it("serializes concurrent version appends without duplicate version numbers", async () => {
    const workspaceId = "workspace-mpc-concurrent" as WorkspaceId;
    await seedWorkspace(workspaceId);

    const connection = ModelProviderConnection.create({
      id: "mpc-concurrent" as ModelProviderConnectionId,
      workspaceId,
      key: "concurrent",
      name: "Concurrent",
      provider: "OPENAI",
      createdAt: NOW,
      updatedAt: NOW,
    });
    await connections.saveConnection(connection);

    const results = await Promise.allSettled([
      connections.appendConnectionVersion({
        id: "mpcv-concurrent-a" as ModelProviderConnectionVersionId,
        connectionId: connection.id,
        createdAt: NOW,
      }),
      connections.appendConnectionVersion({
        id: "mpcv-concurrent-b" as ModelProviderConnectionVersionId,
        connectionId: connection.id,
        createdAt: NOW,
      }),
    ]);

    const fulfilled = results.filter(
      (
        result,
      ): result is PromiseFulfilledResult<
        Awaited<ReturnType<typeof connections.appendConnectionVersion>>
      > => result.status === "fulfilled",
    );
    const rejected = results.filter((result) => result.status === "rejected");

    expect(fulfilled).toHaveLength(2);
    expect(rejected).toHaveLength(0);
    const versions = fulfilled
      .map((result) => result.value.version)
      .sort((left, right) => left - right);
    expect(versions).toEqual([1, 2]);
  });

  it("isolates connections by workspace", async () => {
    const workspaceA = "workspace-mpc-a" as WorkspaceId;
    const workspaceB = "workspace-mpc-b" as WorkspaceId;
    await seedWorkspace(workspaceA, "A");
    await seedWorkspace(workspaceB, "B");

    const connectionA = ModelProviderConnection.create({
      id: "mpc-ws-a" as ModelProviderConnectionId,
      workspaceId: workspaceA,
      key: "shared-key",
      name: "A",
      provider: "OPENAI",
      createdAt: NOW,
      updatedAt: NOW,
    });
    const connectionB = ModelProviderConnection.create({
      id: "mpc-ws-b" as ModelProviderConnectionId,
      workspaceId: workspaceB,
      key: "shared-key",
      name: "B",
      provider: "OPENAI",
      createdAt: NOW,
      updatedAt: NOW,
    });
    await connections.saveConnection(connectionA);
    await connections.saveConnection(connectionB);

    expect(
      await connections.findConnectionByWorkspaceAndId(
        workspaceA,
        connectionB.id,
      ),
    ).toBeNull();
    expect(
      await connections.findConnectionByWorkspaceAndId(
        workspaceB,
        connectionA.id,
      ),
    ).toBeNull();
  });

  it("binds model profile versions to connection versions and keeps legacy null bindings", async () => {
    const workspaceId = "workspace-mpc-profile" as WorkspaceId;
    await seedWorkspace(workspaceId);

    const connection = ModelProviderConnection.create({
      id: "mpc-profile" as ModelProviderConnectionId,
      workspaceId,
      key: "bound",
      name: "Bound",
      provider: "OPENAI",
      createdAt: NOW,
      updatedAt: NOW,
    });
    await connections.saveConnection(connection);
    const connectionVersion = await connections.appendConnectionVersion({
      id: "mpcv-profile" as ModelProviderConnectionVersionId,
      connectionId: connection.id,
      createdAt: NOW,
    });

    const profile = ModelProfile.create({
      id: "mp-profile" as ModelProfileId,
      workspaceId,
      key: "primary",
      name: "Primary",
      createdAt: NOW,
    });
    await modelProfiles.saveModelProfile(profile);

    const legacyVersion = await modelProfiles.appendModelProfileVersion({
      id: "mpv-legacy" as ModelProfileVersionId,
      modelProfileId: profile.id,
      provider: "OPENAI",
      model: "gpt-legacy",
      createdAt: NOW,
    });
    const boundVersion = await modelProfiles.appendModelProfileVersion({
      id: "mpv-bound" as ModelProfileVersionId,
      modelProfileId: profile.id,
      provider: "OPENAI",
      model: "gpt-bound",
      modelProviderConnectionVersionId: connectionVersion.id,
      createdAt: NOW,
    });

    expect(legacyVersion.modelProviderConnectionVersionId).toBeUndefined();
    expect(boundVersion.modelProviderConnectionVersionId).toBe(
      connectionVersion.id,
    );
  });

  it("enforces foreign keys for invalid connection version references", async () => {
    const workspaceId = "workspace-mpc-fk" as WorkspaceId;
    await seedWorkspace(workspaceId);

    const profile = ModelProfile.create({
      id: "mp-fk" as ModelProfileId,
      workspaceId,
      key: "fk",
      name: "FK",
      createdAt: NOW,
    });
    await modelProfiles.saveModelProfile(profile);

    await expect(
      modelProfiles.appendModelProfileVersion({
        id: "mpv-fk" as ModelProfileVersionId,
        modelProfileId: profile.id,
        provider: "OPENAI",
        model: "gpt-fk",
        modelProviderConnectionVersionId:
          "mpcv-missing" as ModelProviderConnectionVersionId,
        createdAt: NOW,
      }),
    ).rejects.toThrow();
  });

  async function seedWorkspace(id: WorkspaceId, name = "Workspace") {
    await workspaces.save(
      Workspace.create({
        id,
        name,
        createdAt: NOW,
      }),
    );
  }
});
