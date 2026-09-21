import type { WorkspaceId } from "@osva/contracts";
import type { Workspace, WorkspaceRepository } from "@osva/domain";

export class MemoryWorkspaceRepository implements WorkspaceRepository {
  private readonly workspaces = new Map<WorkspaceId, Workspace>();

  async save(workspace: Workspace): Promise<void> {
    this.workspaces.set(workspace.id, workspace);
  }

  async findById(id: WorkspaceId): Promise<Workspace | null> {
    return this.workspaces.get(id) ?? null;
  }

  async countAll(): Promise<number> {
    return this.workspaces.size;
  }

  async listIds(): Promise<readonly WorkspaceId[]> {
    return [...this.workspaces.keys()].sort();
  }
}
