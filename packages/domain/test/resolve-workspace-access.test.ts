import type { UserId, WorkspaceId } from "@osva-ai/contracts";
import { HUMAN_WORKSPACE_ROLES, USER_STATUSES } from "@osva-ai/contracts";
import { describe, expect, it } from "vitest";

import { resolveWorkspaceAccess } from "../src/resolve-workspace-access.js";
import type { UserRepository } from "../src/ports/user-repository.js";
import type { WorkspaceMembershipRepository } from "../src/ports/workspace-membership-repository.js";
import { User } from "../src/user.js";
import { WorkspaceMembership } from "../src/workspace-membership.js";
import { NOW } from "./fixtures.js";

const WORKSPACE_ID = "ws-access" as WorkspaceId;
const USER_ID = "user-access" as UserId;

class MemoryUserRepository implements UserRepository {
  readonly users = new Map<UserId, User>();

  async save(user: User): Promise<void> {
    this.users.set(user.id, user);
  }

  async findById(id: UserId): Promise<User | null> {
    return this.users.get(id) ?? null;
  }

  async findByEmail(email: string): Promise<User | null> {
    return (
      [...this.users.values()].find((user) => user.email === email) ?? null
    );
  }
}

class MemoryWorkspaceMembershipRepository implements WorkspaceMembershipRepository {
  readonly memberships: WorkspaceMembership[] = [];

  async save(membership: WorkspaceMembership): Promise<void> {
    this.memberships.push(membership);
  }

  async findById(): Promise<WorkspaceMembership | null> {
    return null;
  }

  async findByWorkspaceAndUser(
    workspaceId: WorkspaceId,
    userId: UserId,
  ): Promise<WorkspaceMembership | null> {
    return (
      this.memberships.find(
        (membership) =>
          membership.workspaceId === workspaceId &&
          membership.userId === userId,
      ) ?? null
    );
  }

  async countByWorkspaceAndRole(): Promise<number> {
    return 0;
  }

  async deleteById(): Promise<void> {}

  async listByUserId(userId: UserId): Promise<readonly WorkspaceMembership[]> {
    return this.memberships.filter(
      (membership) => membership.userId === userId,
    );
  }

  async listByWorkspaceId(
    workspaceId: WorkspaceId,
  ): Promise<readonly WorkspaceMembership[]> {
    return this.memberships.filter(
      (membership) => membership.workspaceId === workspaceId,
    );
  }
}

describe("resolveWorkspaceAccess", () => {
  it("returns membership role for active users", async () => {
    const users = new MemoryUserRepository();
    const workspaceMemberships = new MemoryWorkspaceMembershipRepository();

    await users.save(
      User.create({
        id: USER_ID,
        email: "member@example.com",
        displayName: "Member",
        status: USER_STATUSES.ACTIVE,
        createdAt: NOW,
      }),
    );
    await workspaceMemberships.save(
      WorkspaceMembership.create({
        id: "wm-1" as never,
        workspaceId: WORKSPACE_ID,
        userId: USER_ID,
        role: HUMAN_WORKSPACE_ROLES.DEVELOPER,
        createdAt: NOW,
      }),
    );

    const resolved = await resolveWorkspaceAccess(
      { users, workspaceMemberships },
      { userId: USER_ID, workspaceId: WORKSPACE_ID },
    );

    expect(resolved).toEqual({
      userId: USER_ID,
      workspaceId: WORKSPACE_ID,
      role: HUMAN_WORKSPACE_ROLES.DEVELOPER,
    });
  });

  it("returns undefined without membership or for disabled users", async () => {
    const users = new MemoryUserRepository();
    const workspaceMemberships = new MemoryWorkspaceMembershipRepository();

    await users.save(
      User.create({
        id: USER_ID,
        email: "disabled@example.com",
        displayName: "Disabled",
        status: USER_STATUSES.DISABLED,
        createdAt: NOW,
      }),
    );

    expect(
      await resolveWorkspaceAccess(
        { users, workspaceMemberships },
        { userId: USER_ID, workspaceId: WORKSPACE_ID },
      ),
    ).toBeUndefined();
  });
});
