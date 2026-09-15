import type { WorkspaceId } from "@osva/contracts";

import type { Workspace } from "../workspace.js";

export interface WorkspaceRepository {
  save(workspace: Workspace): Promise<void>;
  findById(id: WorkspaceId): Promise<Workspace | null>;
}
