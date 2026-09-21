import type { ConnectorId, ConnectorVersionId } from "@osva/contracts";
import {
  Connector,
  ConnectorNotFoundError,
  ConnectorVersion,
  ConnectorVersionNotFoundError,
  DomainInvariantError,
  DuplicateConnectorKeyError,
  Workspace,
  createConnectorApplication,
} from "@osva/domain";
import { describe, expect, it, vi } from "vitest";
import type { McpClientPool } from "@osva/contracts";

import { MemoryConnectorRepository } from "../src/memory-connector-repository.js";
import { MemoryToolRepository } from "../src/memory-tool-repository.js";
import { MemoryWorkspaceRepository } from "../src/memory-workspace-repository.js";
import { NOW, otherWorkspaceId, workspaceId } from "./fixtures.js";
import { fakeControlPlaneScope } from "./test-scope.js";

const scope = fakeControlPlaneScope(workspaceId);

describe("MemoryConnectorRepository", () => {
  it("creates, reads, lists, and renames Connectors", async () => {
    const { application } = await createHarness();
    const created = await application.createConnector.execute(scope, {
      workspaceId,
      key: "github",
      name: "GitHub",
    });
    const loaded = await application.getConnector.execute(scope, created.id);
    const listed = await application.listConnectors.execute(scope);
    const renamed = await application.updateConnectorMetadata.execute(scope, {
      connectorId: created.id,
      name: "Renamed GitHub",
    });

    expect(loaded.name).toBe("GitHub");
    expect(listed).toHaveLength(1);
    expect(renamed.name).toBe("Renamed GitHub");
    expect(renamed.key).toBe("github");
    expect(renamed.workspaceId).toBe(workspaceId);
  });

  it("rejects an unknown Connector", async () => {
    const { application } = await createHarness();
    await expect(
      application.getConnector.execute(scope, "missing" as ConnectorId),
    ).rejects.toBeInstanceOf(ConnectorNotFoundError);
  });

  it("appends immutable ConnectorVersions with per-connector numbering", async () => {
    const { application } = await createHarness();
    const first = await application.createConnector.execute(scope, {
      workspaceId,
      key: "primary",
      name: "Primary",
    });
    const second = await application.createConnector.execute(scope, {
      workspaceId,
      key: "secondary",
      name: "Secondary",
    });
    const v1 = await application.appendConnectorVersion.execute(scope, {
      connectorId: first.id,
      kind: "MCP",
      transport: "STREAMABLE_HTTP",
      transportConfig: { endpointUrl: "http://127.0.0.1:9001" },
    });
    const v2 = await application.appendConnectorVersion.execute(scope, {
      connectorId: first.id,
      kind: "MCP",
      transport: "STDIO",
      transportConfig: { command: "node", args: ["server.mjs"] },
    });
    const otherV1 = await application.appendConnectorVersion.execute(scope, {
      connectorId: second.id,
      kind: "MCP",
      transport: "STREAMABLE_HTTP",
      transportConfig: { endpointUrl: "http://127.0.0.1:9002" },
    });

    expect(v1.version).toBe(1);
    expect(v2.version).toBe(2);
    expect(otherV1.version).toBe(1);
    expect(v1.transport).toBe("STREAMABLE_HTTP");
    expect(v2.transport).toBe("STDIO");
    expect(JSON.stringify(v1)).not.toContain("token");
    expect(JSON.stringify(v1)).not.toContain("secret");
  });

  it("enforces nested ConnectorVersion ownership", async () => {
    const { application } = await createHarness();
    const first = await application.createConnector.execute(scope, {
      workspaceId,
      key: "primary",
      name: "Primary",
    });
    const second = await application.createConnector.execute(scope, {
      workspaceId,
      key: "secondary",
      name: "Secondary",
    });
    const version = await application.appendConnectorVersion.execute(scope, {
      connectorId: first.id,
      kind: "MCP",
      transport: "STREAMABLE_HTTP",
      transportConfig: { endpointUrl: "http://127.0.0.1:9001" },
    });

    await expect(
      application.getConnectorVersion.execute(scope, {
        connectorId: second.id,
        connectorVersionId: version.id,
      }),
    ).rejects.toBeInstanceOf(ConnectorVersionNotFoundError);
  });

  it("has no ConnectorVersion update operation", async () => {
    const { application, repository } = await createHarness();
    expect(application).not.toHaveProperty("updateConnectorVersion");
    expect(repository).not.toHaveProperty("updateConnectorVersion");
  });

  it("rejects replacing an immutable ConnectorVersion", async () => {
    const repository = new MemoryConnectorRepository();
    const connector = Connector.create({
      id: "connector-1" as ConnectorId,
      workspaceId,
      key: "primary",
      name: "Primary",
      createdAt: NOW,
      updatedAt: NOW,
    });
    await repository.saveConnector(connector);
    const version = ConnectorVersion.create({
      id: "connector-version-1" as ConnectorVersionId,
      connectorId: connector.id,
      version: 1,
      kind: "MCP",
      transport: "STREAMABLE_HTTP",
      transportConfig: { endpointUrl: "http://127.0.0.1:9001" },
      createdAt: NOW,
    });
    await repository.saveConnectorVersion(version);
    await expect(
      repository.saveConnectorVersion(
        ConnectorVersion.create({
          id: version.id,
          connectorId: connector.id,
          version: 1,
          kind: "MCP",
          transport: "STDIO",
          transportConfig: { command: "node", args: ["other.mjs"] },
          createdAt: NOW,
        }),
      ),
    ).rejects.toBeInstanceOf(DomainInvariantError);
  });

  it("rejects a duplicate Connector key in the same workspace", async () => {
    const { application } = await createHarness();
    await application.createConnector.execute(scope, {
      workspaceId,
      key: "primary",
      name: "Primary",
    });
    await expect(
      application.createConnector.execute(scope, {
        workspaceId,
        key: "primary",
        name: "Other",
      }),
    ).rejects.toBeInstanceOf(DuplicateConnectorKeyError);
  });

  it("allows the same Connector key in a different workspace", async () => {
    const workspaces = new MemoryWorkspaceRepository();
    await workspaces.save(
      Workspace.create({
        id: workspaceId,
        name: "Workspace",
        createdAt: NOW,
      }),
    );
    await workspaces.save(
      Workspace.create({
        id: otherWorkspaceId,
        name: "Other Workspace",
        createdAt: NOW,
      }),
    );
    const repository = new MemoryConnectorRepository();
    await repository.saveConnector(
      Connector.create({
        id: "connector-1" as ConnectorId,
        workspaceId,
        key: "shared-key",
        name: "Primary",
        createdAt: NOW,
        updatedAt: NOW,
      }),
    );
    await repository.saveConnector(
      Connector.create({
        id: "connector-2" as ConnectorId,
        workspaceId: otherWorkspaceId,
        key: "shared-key",
        name: "Other Workspace Connector",
        createdAt: NOW,
        updatedAt: NOW,
      }),
    );

    const listed = await repository.listConnectors();
    expect(listed).toHaveLength(2);
    expect(
      listed.filter((connector) => connector.key === "shared-key"),
    ).toHaveLength(2);
  });

  it("rejects appending a version to a missing Connector", async () => {
    const { application } = await createHarness();
    await expect(
      application.appendConnectorVersion.execute(scope, {
        connectorId: "missing" as ConnectorId,
        kind: "MCP",
        transport: "STREAMABLE_HTTP",
        transportConfig: { endpointUrl: "http://127.0.0.1:9001" },
      }),
    ).rejects.toBeInstanceOf(ConnectorNotFoundError);
  });
});

async function createHarness() {
  const workspaces = new MemoryWorkspaceRepository();
  const repository = new MemoryConnectorRepository();
  const tools = new MemoryToolRepository();
  await workspaces.save(
    Workspace.create({
      id: workspaceId,
      name: "Workspace",
      createdAt: NOW,
    }),
  );
  let counter = 0;
  const mcpClientPool: McpClientPool = {
    discoverTools: vi.fn(async () => []),
    invokeTool: vi.fn(),
    close: vi.fn(async () => undefined),
  };
  return {
    repository,
    application: createConnectorApplication({
      connectors: repository,
      tools,
      workspaces,
      mcpClientPool,
      mcpRuntimePolicy: { stdioConnectorsEnabled: true },
      clock: { now: () => NOW },
      ids: {
        createId() {
          counter += 1;
          return `connector-${String(counter)}`;
        },
      },
    }),
  };
}
