import type {
  UserId,
  WorkspaceId,
  WorkspaceMembershipId,
} from "@osva-ai/contracts";
import {
  AUTHENTICATION_METHODS,
  AUTHORIZATION_ACTIONS,
  HUMAN_WORKSPACE_ROLES,
  USER_STATUSES,
} from "@osva-ai/contracts";
import { describe, expect, it } from "vitest";

import {
  controlPlaneWorkspaceId,
  requireControlPlaneAuthorization,
} from "../src/control-plane.js";
import { PermissionDeniedError } from "../src/security-errors.js";
import { resolveHumanControlPlaneWorkspace } from "../src/resolve-human-control-plane-workspace.js";
import { WorkspaceSelectionRequiredError } from "../src/human-authorization.js";
import { User } from "../src/user.js";
import { WorkspaceMembership } from "../src/workspace-membership.js";
import type { UserRepository } from "../src/ports/user-repository.js";
import type { WorkspaceMembershipRepository } from "../src/ports/workspace-membership-repository.js";
import { NOW } from "./fixtures.js";

const WS_A = "ws-a" as WorkspaceId;
const WS_B = "ws-b" as WorkspaceId;
const USER = "user-1" as UserId;

function memoryDeps(): {
  users: UserRepository;
  workspaceMemberships: WorkspaceMembershipRepository;
} {
  const user = User.create({
    id: USER,
    email: "user@example.com",
    displayName: "User",
    status: USER_STATUSES.ACTIVE,
    createdAt: NOW,
  });
  const users: UserRepository = {
    async save() {},
    async findById(id) {
      return id === USER ? user : null;
    },
    async findByEmail() {
      return user;
    },
  };
  const memberships = [
    WorkspaceMembership.create({
      id: "wm-a" as WorkspaceMembershipId,
      workspaceId: WS_A,
      userId: USER,
      role: HUMAN_WORKSPACE_ROLES.VIEWER,
      createdAt: NOW,
    }),
    WorkspaceMembership.create({
      id: "wm-b" as WorkspaceMembershipId,
      workspaceId: WS_B,
      userId: USER,
      role: HUMAN_WORKSPACE_ROLES.OWNER,
      createdAt: NOW,
    }),
  ];
  const workspaceMemberships: WorkspaceMembershipRepository = {
    async save() {},
    async findById() {
      return null;
    },
    async findByWorkspaceAndUser(workspaceId, userId) {
      return (
        memberships.find(
          (membership) =>
            membership.workspaceId === workspaceId &&
            membership.userId === userId,
        ) ?? null
      );
    },
    async listByWorkspaceId() {
      return [];
    },
    async listByUserId(userId) {
      return memberships.filter((membership) => membership.userId === userId);
    },
    async countByWorkspaceAndRole() {
      return 0;
    },
    async deleteById() {},
  };
  return { users, workspaceMemberships };
}

describe("human control-plane authorization", () => {
  it("requires workspace selection when multiple memberships exist", async () => {
    const deps = memoryDeps();
    await expect(
      resolveHumanControlPlaneWorkspace(deps, { userId: USER }),
    ).rejects.toBeInstanceOf(WorkspaceSelectionRequiredError);
  });

  it("denies VIEWER write actions on the control plane", () => {
    const scope = {
      principal: {
        authenticationMethod: AUTHENTICATION_METHODS.HUMAN_SESSION,
        userId: USER,
        sessionId: "sess-1",
        workspaceId: WS_A,
        humanRole: HUMAN_WORKSPACE_ROLES.VIEWER,
      },
    };
    expect(controlPlaneWorkspaceId(scope)).toBe(WS_A);
    expect(() =>
      requireControlPlaneAuthorization(scope, AUTHORIZATION_ACTIONS.WRITE, {
        kind: "agent",
      }),
    ).toThrow(PermissionDeniedError);
  });

  it("permits OWNER admin actions in workspace scope", () => {
    const scope = {
      principal: {
        authenticationMethod: AUTHENTICATION_METHODS.HUMAN_SESSION,
        userId: USER,
        sessionId: "sess-1",
        workspaceId: WS_B,
        humanRole: HUMAN_WORKSPACE_ROLES.OWNER,
      },
    };
    expect(() =>
      requireControlPlaneAuthorization(scope, AUTHORIZATION_ACTIONS.ADMIN, {
        kind: "api_key",
      }),
    ).not.toThrow();
  });

  it("denies DEVELOPER admin actions", () => {
    const scope = {
      principal: {
        authenticationMethod: AUTHENTICATION_METHODS.HUMAN_SESSION,
        userId: USER,
        sessionId: "sess-1",
        workspaceId: WS_A,
        humanRole: HUMAN_WORKSPACE_ROLES.DEVELOPER,
      },
    };
    expect(() =>
      requireControlPlaneAuthorization(scope, AUTHORIZATION_ACTIONS.ADMIN, {
        kind: "connector",
      }),
    ).toThrow(PermissionDeniedError);
  });
});
