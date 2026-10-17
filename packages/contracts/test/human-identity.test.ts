import { describe, expect, it } from "vitest";

import {
  HUMAN_WORKSPACE_PERMISSIONS,
  HUMAN_WORKSPACE_ROLES,
  ORGANIZATION_MEMBERSHIP_ROLES,
  humanWorkspaceRolePermitsAuthorizationAction,
  humanWorkspaceRolePermitsPermission,
  normalizeUserEmail,
} from "../src/human-identity.js";
import { AUTHORIZATION_ACTIONS } from "../src/security.js";

describe("human identity contracts", () => {
  it("freezes human workspace and organization membership roles", () => {
    expect(Object.keys(HUMAN_WORKSPACE_ROLES).sort()).toEqual([
      "ADMIN",
      "DEVELOPER",
      "OPERATOR",
      "OWNER",
      "VIEWER",
    ]);
    expect(Object.keys(ORGANIZATION_MEMBERSHIP_ROLES).sort()).toEqual([
      "ADMIN",
      "MEMBER",
      "OWNER",
    ]);
  });

  it("maps human workspace roles to permissions", () => {
    expect(
      humanWorkspaceRolePermitsPermission(
        HUMAN_WORKSPACE_ROLES.VIEWER,
        HUMAN_WORKSPACE_PERMISSIONS.READ,
      ),
    ).toBe(true);
    expect(
      humanWorkspaceRolePermitsPermission(
        HUMAN_WORKSPACE_ROLES.VIEWER,
        HUMAN_WORKSPACE_PERMISSIONS.EXECUTE,
      ),
    ).toBe(false);
    expect(
      humanWorkspaceRolePermitsPermission(
        HUMAN_WORKSPACE_ROLES.OWNER,
        HUMAN_WORKSPACE_PERMISSIONS.TRANSFER_OWNERSHIP,
      ),
    ).toBe(true);
    expect(
      humanWorkspaceRolePermitsPermission(
        HUMAN_WORKSPACE_ROLES.ADMIN,
        HUMAN_WORKSPACE_PERMISSIONS.TRANSFER_OWNERSHIP,
      ),
    ).toBe(false);
  });

  it("maps human workspace roles to authorization actions for future sessions", () => {
    expect(
      humanWorkspaceRolePermitsAuthorizationAction(
        HUMAN_WORKSPACE_ROLES.DEVELOPER,
        AUTHORIZATION_ACTIONS.WRITE,
      ),
    ).toBe(true);
    expect(
      humanWorkspaceRolePermitsAuthorizationAction(
        HUMAN_WORKSPACE_ROLES.DEVELOPER,
        AUTHORIZATION_ACTIONS.ADMIN,
      ),
    ).toBe(false);
  });

  it("normalizes user email", () => {
    expect(normalizeUserEmail("  User@Example.COM ")).toBe("user@example.com");
  });
});
