import type {
  UserId,
  WorkspaceId,
  WorkspaceMembershipId,
} from "@osva-ai/contracts";
import { HUMAN_WORKSPACE_ROLES, USER_STATUSES } from "@osva-ai/contracts";
import { describe, expect, it } from "vitest";

import { IdentityApplication } from "../src/identity-application.js";
import { PermissionDeniedError } from "../src/security-errors.js";
import { WorkspaceMembership } from "../src/workspace-membership.js";
import type {
  CreateWorkspaceMembershipInput,
  IdentityLifecycleRepository,
} from "../src/ports/identity-lifecycle-repository.js";
import type { UserRepository } from "../src/ports/user-repository.js";
import type { WorkspaceMembershipRepository } from "../src/ports/workspace-membership-repository.js";
import type { WorkspaceRepository } from "../src/ports/workspace-repository.js";
import { User } from "../src/user.js";
import { Workspace } from "../src/workspace.js";
import { NOW } from "./fixtures.js";

class MemoryLifecycle implements IdentityLifecycleRepository {
  constructor(
    private readonly workspaceMemberships: MemoryWorkspaceMembershipRepository,
  ) {}

  async registerUser(): Promise<void> {}
  async createOrganizationWithOwner(): Promise<void> {}
  async assignWorkspaceOwnerMembership(): Promise<void> {}
  async createWorkspaceMembership(
    input: CreateWorkspaceMembershipInput,
  ): Promise<void> {
    await this.workspaceMemberships.save(input.membership);
  }
  async transferWorkspaceOwnership(): Promise<void> {}
  async changeWorkspaceMembershipRole(): Promise<void> {}
  async removeWorkspaceMembership(): Promise<void> {}
}

class MemoryWorkspaceMembershipRepository implements WorkspaceMembershipRepository {
  readonly records: WorkspaceMembership[] = [];

  reset(): void {
    this.records.length = 0;
  }

  async save(membership: WorkspaceMembership): Promise<void> {
    this.records.push(membership);
  }

  async findById(
    id: WorkspaceMembershipId,
  ): Promise<WorkspaceMembership | null> {
    return this.records.find((record) => record.id === id) ?? null;
  }

  async findByWorkspaceAndUser(
    workspaceId: WorkspaceId,
    userId: UserId,
  ): Promise<WorkspaceMembership | null> {
    return (
      this.records.find(
        (record) =>
          record.workspaceId === workspaceId && record.userId === userId,
      ) ?? null
    );
  }

  async countByWorkspaceAndRole(
    workspaceId: WorkspaceId,
    role: WorkspaceMembership["role"],
  ): Promise<number> {
    return this.records.filter(
      (record) => record.workspaceId === workspaceId && record.role === role,
    ).length;
  }

  async deleteById(id: WorkspaceMembershipId): Promise<void> {
    const index = this.records.findIndex((record) => record.id === id);
    if (index >= 0) {
      this.records.splice(index, 1);
    }
  }

  async listByUserId(userId: UserId): Promise<readonly WorkspaceMembership[]> {
    return this.records.filter((record) => record.userId === userId);
  }

  async listByWorkspaceId(
    workspaceId: WorkspaceId,
  ): Promise<readonly WorkspaceMembership[]> {
    return this.records.filter((record) => record.workspaceId === workspaceId);
  }
}

class MemoryUserRepository implements UserRepository {
  readonly users = new Map<UserId, User>();

  reset(): void {
    this.users.clear();
  }

  async save(user: User): Promise<void> {
    this.users.set(user.id, user);
  }

  async findById(id: UserId): Promise<User | null> {
    return this.users.get(id) ?? null;
  }

  async findByEmail(): Promise<User | null> {
    return null;
  }
}

class MemoryWorkspaceRepository implements WorkspaceRepository {
  readonly workspaces: Workspace[] = [];

  reset(): void {
    this.workspaces.length = 0;
  }

  async save(workspace: Workspace): Promise<void> {
    this.workspaces.push(workspace);
  }

  async findById(id: WorkspaceId): Promise<Workspace | null> {
    return this.workspaces.find((workspace) => workspace.id === id) ?? null;
  }

  async countAll(): Promise<number> {
    return this.workspaces.length;
  }

  async listIds(): Promise<WorkspaceId[]> {
    return this.workspaces.map((workspace) => workspace.id);
  }

  async listUnlinkedIds(): Promise<readonly WorkspaceId[]> {
    return this.workspaces
      .filter((workspace) => workspace.organizationId === undefined)
      .map((workspace) => workspace.id);
  }
}

const memoryMemberships = new MemoryWorkspaceMembershipRepository();
const memoryUsers = new MemoryUserRepository();
const memoryWorkspaces = new MemoryWorkspaceRepository();

describe("IdentityApplication owner authorization", () => {
  it("denies ADMIN from granting OWNER membership when an OWNER already exists", async () => {
    memoryMemberships.reset();
    memoryUsers.reset();
    memoryWorkspaces.reset();

    const workspaceId = "ws-app" as WorkspaceId;
    await memoryWorkspaces.save(
      Workspace.create({ id: workspaceId, name: "App", createdAt: NOW }),
    );

    const ownerId = "user-owner" as UserId;
    const adminId = "user-admin" as UserId;
    const candidateId = "user-candidate" as UserId;

    for (const [id, email] of [
      [ownerId, "owner@example.com"],
      [adminId, "admin@example.com"],
      [candidateId, "candidate@example.com"],
    ] as const) {
      await memoryUsers.save(
        User.create({
          id,
          email,
          displayName: id,
          status: USER_STATUSES.ACTIVE,
          createdAt: NOW,
        }),
      );
    }

    memoryMemberships.records.push(
      WorkspaceMembership.create({
        id: "wm-owner" as WorkspaceMembershipId,
        workspaceId,
        userId: ownerId,
        role: HUMAN_WORKSPACE_ROLES.OWNER,
        createdAt: NOW,
      }),
      WorkspaceMembership.create({
        id: "wm-admin" as WorkspaceMembershipId,
        workspaceId,
        userId: adminId,
        role: HUMAN_WORKSPACE_ROLES.ADMIN,
        createdAt: NOW,
      }),
    );

    const app = new IdentityApplication({
      users: memoryUsers,
      workspaceMemberships: memoryMemberships,
      workspaces: memoryWorkspaces,
      lifecycle: new MemoryLifecycle(memoryMemberships),
      clock: { now: () => NOW },
      ids: { createId: () => "ignored" },
    });

    await expect(
      app.addWorkspaceMembership({
        workspaceId,
        userId: candidateId,
        role: HUMAN_WORKSPACE_ROLES.OWNER,
        actorUserId: adminId,
      }),
    ).rejects.toBeInstanceOf(PermissionDeniedError);
  });
});
