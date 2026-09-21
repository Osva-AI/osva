import type { ToolId, ToolVersionId } from "@osva/contracts";
import {
  DomainInvariantError,
  DuplicateToolKeyError,
  ToolNotFoundError,
  ToolVersionNotFoundError,
  Workspace,
  createToolApplication,
} from "@osva/domain";
import { describe, expect, it } from "vitest";

import { MemoryToolRepository } from "../src/memory-tool-repository.js";
import { MemoryWorkspaceRepository } from "../src/memory-workspace-repository.js";
import { NOW, workspaceId } from "./fixtures.js";
import { fakeControlPlaneScope } from "./test-scope.js";

const scope = fakeControlPlaneScope(workspaceId);

describe("MemoryToolRepository", () => {
  it("creates, reads, lists, and renames Tools", async () => {
    const { application } = await createHarness();
    const created = await application.createTool.execute(scope, {
      workspaceId,
      key: "echo",
      name: "Echo",
    });
    const loaded = await application.getTool.execute(scope, created.id);
    const listed = await application.listTools.execute(scope);
    const renamed = await application.updateToolMetadata.execute(scope, {
      toolId: created.id,
      name: "Renamed Echo",
    });

    expect(loaded.name).toBe("Echo");
    expect(listed).toHaveLength(1);
    expect(renamed.name).toBe("Renamed Echo");
    expect(renamed.key).toBe("echo");
  });

  it("rejects an unknown Tool", async () => {
    const { application } = await createHarness();
    await expect(
      application.getTool.execute(scope, "missing" as ToolId),
    ).rejects.toBeInstanceOf(ToolNotFoundError);
  });

  it("appends immutable ToolVersions with per-tool numbering", async () => {
    const { application } = await createHarness();
    const first = await application.createTool.execute(scope, {
      workspaceId,
      key: "echo",
      name: "Echo",
    });
    const second = await application.createTool.execute(scope, {
      workspaceId,
      key: "clock",
      name: "Clock",
    });
    const v1 = await application.appendToolVersion.execute(scope, {
      toolId: first.id,
      type: "INTERNAL",
      implementation: "OSVA_ECHO_V1",
    });
    const v2 = await application.appendToolVersion.execute(scope, {
      toolId: first.id,
      type: "INTERNAL",
      implementation: "OSVA_ECHO_V1",
    });
    const otherV1 = await application.appendToolVersion.execute(scope, {
      toolId: second.id,
      type: "INTERNAL",
      implementation: "OSVA_CLOCK_NOW_V1",
    });

    expect(v1.version).toBe(1);
    expect(v2.version).toBe(2);
    expect(otherV1.version).toBe(1);
  });

  it("enforces nested ToolVersion ownership", async () => {
    const { application } = await createHarness();
    const first = await application.createTool.execute(scope, {
      workspaceId,
      key: "echo",
      name: "Echo",
    });
    const second = await application.createTool.execute(scope, {
      workspaceId,
      key: "clock",
      name: "Clock",
    });
    const version = await application.appendToolVersion.execute(scope, {
      toolId: first.id,
      type: "INTERNAL",
      implementation: "OSVA_ECHO_V1",
    });

    await expect(
      application.getToolVersion.execute(scope, {
        toolId: second.id,
        toolVersionId: version.id,
      }),
    ).rejects.toBeInstanceOf(ToolVersionNotFoundError);
  });

  it("rejects duplicate tool keys in a workspace", async () => {
    const tools = new MemoryToolRepository();
    const workspaces = new MemoryWorkspaceRepository();
    await workspaces.save(
      Workspace.create({
        id: workspaceId,
        name: "Workspace",
        createdAt: NOW,
      }),
    );
    let counter = 0;
    const application = createToolApplication({
      tools,
      workspaces,
      clock: { now: () => NOW },
      ids: {
        createId() {
          counter += 1;
          return `tool-${String(counter)}`;
        },
      },
    });

    await application.createTool.execute(scope, {
      workspaceId,
      key: "echo",
      name: "Echo",
    });

    await expect(
      application.createTool.execute(scope, {
        workspaceId,
        key: "echo",
        name: "Duplicate",
      }),
    ).rejects.toBeInstanceOf(DuplicateToolKeyError);
  });

  it("rejects replacing an immutable ToolVersion", async () => {
    const tools = new MemoryToolRepository();
    const { application } = await createHarnessWithRepo(tools);
    const tool = await application.createTool.execute(scope, {
      workspaceId,
      key: "echo",
      name: "Echo",
    });
    const version = await application.appendToolVersion.execute(scope, {
      toolId: tool.id,
      type: "INTERNAL",
      implementation: "OSVA_ECHO_V1",
    });

    await expect(
      tools.saveToolVersion(
        (await import("@osva/domain")).ToolVersion.create({
          id: version.id,
          toolId: tool.id,
          version: version.version,
          type: "INTERNAL",
          implementation: "OSVA_CLOCK_NOW_V1",
          createdAt: NOW,
        }),
      ),
    ).rejects.toBeInstanceOf(DomainInvariantError);
  });
});

async function createHarness() {
  const tools = new MemoryToolRepository();
  return createHarnessWithRepo(tools);
}

async function createHarnessWithRepo(tools: MemoryToolRepository) {
  const workspaces = new MemoryWorkspaceRepository();
  await workspaces.save(
    Workspace.create({
      id: workspaceId,
      name: "Workspace",
      createdAt: NOW,
    }),
  );
  let counter = 0;
  return {
    tools,
    application: createToolApplication({
      tools,
      workspaces,
      clock: { now: () => NOW },
      ids: {
        createId() {
          counter += 1;
          return `generated-${String(counter)}` as ToolVersionId;
        },
      },
    }),
  };
}
