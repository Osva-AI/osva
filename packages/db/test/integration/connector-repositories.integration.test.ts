import type {
  ConnectorId,
  ConnectorVersionId,
  WorkspaceId,
} from "@osva/contracts";
import {
  Connector,
  ConnectorVersion,
  DomainInvariantError,
  Workspace,
} from "@osva/domain";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createDatabase, type Database } from "../../src/database.js";
import { migrateDatabase } from "../../src/migrate.js";
import { PostgresConnectorRepository } from "../../src/repositories/postgres-connector-repository.js";
import { PostgresWorkspaceRepository } from "../../src/repositories/postgres-workspace-repository.js";
import { connectorVersions } from "../../src/schema/connector-versions.js";
import { createIds, NOW } from "./fixtures.js";
import {
  resetStage0Tables,
  startPostgresForTests,
  stopPostgresForTests,
  type PostgresTestContext,
} from "./postgres-harness.js";

describe("PostgreSQL connector repository", () => {
  let context: PostgresTestContext;
  let database: Database;
  let workspaces: PostgresWorkspaceRepository;
  let connectors: PostgresConnectorRepository;

  beforeAll(async () => {
    context = await startPostgresForTests();
    database = createDatabase({
      connectionString: context.connectionString,
      max: 5,
      connectTimeoutSeconds: 10,
    });
    await migrateDatabase(database);
    workspaces = new PostgresWorkspaceRepository(database);
    connectors = new PostgresConnectorRepository(database);
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

  it("persists Connectors and immutable ConnectorVersions with round-tripped config", async () => {
    const ids = createIds("connector");
    await seedWorkspace(ids.workspaceId);

    const connector = Connector.create({
      id: "connector-1" as ConnectorId,
      workspaceId: ids.workspaceId,
      key: "fake-mcp",
      name: "Fake MCP",
      description: "Repository test connector",
      createdAt: NOW,
      updatedAt: NOW,
    });
    await connectors.saveConnector(connector);

    const httpVersion = await connectors.appendConnectorVersion({
      id: "connector-version-1" as ConnectorVersionId,
      connectorId: connector.id,
      kind: "MCP",
      transport: "STREAMABLE_HTTP",
      transportConfig: { endpointUrl: "http://127.0.0.1:9001/mcp" },
      auth: {
        type: "BEARER",
        tokenSecret: { key: "MCP_TEST_TOKEN" },
      },
      createdAt: NOW,
    });
    const stdioVersion = await connectors.appendConnectorVersion({
      id: "connector-version-2" as ConnectorVersionId,
      connectorId: connector.id,
      kind: "MCP",
      transport: "STDIO",
      transportConfig: {
        command: "node",
        args: ["server.mjs"],
        cwd: "/tmp/mcp",
      },
      createdAt: NOW,
    });

    const loadedConnector = await connectors.findConnectorById(connector.id);
    const loadedHttp = await connectors.findConnectorVersionById(
      httpVersion.id,
    );
    const listed = await connectors.listConnectorVersions(connector.id);
    const [rawAuthRow] = await database.db
      .select({ auth: connectorVersions.auth })
      .from(connectorVersions)
      .where(eq(connectorVersions.id, httpVersion.id))
      .limit(1);

    expect(loadedConnector).toMatchObject({
      id: connector.id,
      workspaceId: ids.workspaceId,
      key: "fake-mcp",
      name: "Fake MCP",
    });
    expect(loadedHttp).toMatchObject({
      id: httpVersion.id,
      connectorId: connector.id,
      version: 1,
      kind: "MCP",
      transport: "STREAMABLE_HTTP",
      transportConfig: { endpointUrl: "http://127.0.0.1:9001/mcp" },
      auth: {
        type: "BEARER",
        tokenSecret: { key: "MCP_TEST_TOKEN" },
      },
    });
    expect(stdioVersion.version).toBe(2);
    expect(stdioVersion.transportConfig).toEqual({
      command: "node",
      args: ["server.mjs"],
      cwd: "/tmp/mcp",
    });
    expect(listed.map((version) => version.version)).toEqual([1, 2]);
    expect(JSON.stringify(rawAuthRow?.auth)).toContain("MCP_TEST_TOKEN");
    expect(JSON.stringify(rawAuthRow?.auth)).not.toContain(
      "super-secret-token-value",
    );
  });

  it("rejects replacing an immutable ConnectorVersion", async () => {
    const ids = createIds("connector-immutable");
    await seedWorkspace(ids.workspaceId);

    const connector = Connector.create({
      id: "connector-immutable" as ConnectorId,
      workspaceId: ids.workspaceId,
      key: "immutable",
      name: "Immutable",
      createdAt: NOW,
      updatedAt: NOW,
    });
    await connectors.saveConnector(connector);
    const version = await connectors.appendConnectorVersion({
      id: "connector-version-immutable" as ConnectorVersionId,
      connectorId: connector.id,
      kind: "MCP",
      transport: "STREAMABLE_HTTP",
      transportConfig: { endpointUrl: "http://127.0.0.1:9001" },
      createdAt: NOW,
    });

    await expect(
      connectors.saveConnectorVersion(
        ConnectorVersion.create({
          id: version.id,
          connectorId: connector.id,
          version: version.version,
          kind: "MCP",
          transport: "STDIO",
          transportConfig: { command: "node", args: ["other.mjs"] },
          createdAt: NOW,
        }),
      ),
    ).rejects.toBeInstanceOf(DomainInvariantError);
  });

  it("isolates Connectors by workspace and versions by connector", async () => {
    const first = createIds("connector-ws-a");
    const second = createIds("connector-ws-b");
    await seedWorkspace(first.workspaceId, "Workspace A");
    await seedWorkspace(second.workspaceId, "Workspace B");

    const connectorA = Connector.create({
      id: "connector-a" as ConnectorId,
      workspaceId: first.workspaceId,
      key: "shared-key",
      name: "Connector A",
      createdAt: NOW,
      updatedAt: NOW,
    });
    const connectorB = Connector.create({
      id: "connector-b" as ConnectorId,
      workspaceId: second.workspaceId,
      key: "shared-key",
      name: "Connector B",
      createdAt: NOW,
      updatedAt: NOW,
    });
    await connectors.saveConnector(connectorA);
    await connectors.saveConnector(connectorB);

    const versionA = await connectors.appendConnectorVersion({
      id: "connector-version-a" as ConnectorVersionId,
      connectorId: connectorA.id,
      kind: "MCP",
      transport: "STREAMABLE_HTTP",
      transportConfig: { endpointUrl: "http://127.0.0.1:9001" },
      createdAt: NOW,
    });
    const versionB = await connectors.appendConnectorVersion({
      id: "connector-version-b" as ConnectorVersionId,
      connectorId: connectorB.id,
      kind: "MCP",
      transport: "STREAMABLE_HTTP",
      transportConfig: { endpointUrl: "http://127.0.0.1:9002" },
      createdAt: NOW,
    });

    const listed = await connectors.listConnectors();
    expect(
      listed.filter((connector) => connector.key === "shared-key"),
    ).toHaveLength(2);
    expect(
      listed.find((connector) => connector.id === connectorA.id)?.workspaceId,
    ).toBe(first.workspaceId);
    expect(
      listed.find((connector) => connector.id === connectorB.id)?.workspaceId,
    ).toBe(second.workspaceId);
    expect(await connectors.listConnectorVersions(connectorA.id)).toEqual([
      versionA,
    ]);
    expect(await connectors.listConnectorVersions(connectorB.id)).toEqual([
      versionB,
    ]);
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
