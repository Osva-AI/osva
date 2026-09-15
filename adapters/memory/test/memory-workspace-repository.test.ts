import type { WorkspaceRepository } from "@osva/domain";
import { Workspace } from "@osva/domain";
import { describe, expect, it } from "vitest";

import { MemoryWorkspaceRepository } from "../src/memory-workspace-repository.js";
import { NOW, workspaceId } from "./fixtures.js";

describe("MemoryWorkspaceRepository", () => {
  it("saves and finds a workspace by id through the port", async () => {
    const repository: WorkspaceRepository = new MemoryWorkspaceRepository();
    const workspace = Workspace.create({
      id: workspaceId,
      name: "Acme",
      createdAt: NOW,
    });

    await repository.save(workspace);

    await expect(repository.findById(workspaceId)).resolves.toBe(workspace);
    await expect(
      repository.findById("missing" as typeof workspaceId),
    ).resolves.toBeNull();
  });

  it("replaces a workspace snapshot on save", async () => {
    const repository: WorkspaceRepository = new MemoryWorkspaceRepository();
    await repository.save(
      Workspace.create({ id: workspaceId, name: "Acme", createdAt: NOW }),
    );
    const renamed = Workspace.create({
      id: workspaceId,
      name: "Renamed",
      createdAt: NOW,
    });
    await repository.save(renamed);

    await expect(repository.findById(workspaceId)).resolves.toBe(renamed);
  });
});
