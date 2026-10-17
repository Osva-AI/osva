import type {
  UserId,
  WorkspaceId,
  WorkspaceMembershipId,
} from "@osva-ai/contracts";
import type { HumanWorkspaceRole } from "@osva-ai/contracts";

import type { WorkspaceMembership } from "../workspace-membership.js";

export interface WorkspaceMembershipRepository {
  save(membership: WorkspaceMembership): Promise<void>;
  findById(id: WorkspaceMembershipId): Promise<WorkspaceMembership | null>;
  findByWorkspaceAndUser(
    workspaceId: WorkspaceId,
    userId: UserId,
  ): Promise<WorkspaceMembership | null>;
  countByWorkspaceAndRole(
    workspaceId: WorkspaceId,
    role: HumanWorkspaceRole,
  ): Promise<number>;
  deleteById(id: WorkspaceMembershipId): Promise<void>;
  listByUserId(userId: UserId): Promise<readonly WorkspaceMembership[]>;
  listByWorkspaceId(
    workspaceId: WorkspaceId,
  ): Promise<readonly WorkspaceMembership[]>;
}
