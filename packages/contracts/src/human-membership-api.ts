import { z } from "zod";

import {
  HUMAN_WORKSPACE_ROLES,
  type HumanWorkspaceRole,
} from "./human-identity.js";

/** Non-owner roles assignable through generic membership routes. */
export const MANAGEABLE_HUMAN_WORKSPACE_ROLES = [
  HUMAN_WORKSPACE_ROLES.ADMIN,
  HUMAN_WORKSPACE_ROLES.DEVELOPER,
  HUMAN_WORKSPACE_ROLES.OPERATOR,
  HUMAN_WORKSPACE_ROLES.VIEWER,
] as const;

export type ManageableHumanWorkspaceRole =
  (typeof MANAGEABLE_HUMAN_WORKSPACE_ROLES)[number];

const manageableRoleSchema = z.enum(MANAGEABLE_HUMAN_WORKSPACE_ROLES);

export const addWorkspaceMembershipRequestSchema = z.object({
  userId: z.string().min(1),
  role: manageableRoleSchema,
});

export type AddWorkspaceMembershipRequestV1 = z.infer<
  typeof addWorkspaceMembershipRequestSchema
>;

export const provisionWorkspaceMemberRequestSchema = z.object({
  email: z.string().email().max(320),
  displayName: z.string().min(1).max(128),
  role: manageableRoleSchema,
});

export type ProvisionWorkspaceMemberRequestV1 = z.infer<
  typeof provisionWorkspaceMemberRequestSchema
>;

export const changeWorkspaceMembershipRoleRequestSchema = z.object({
  role: manageableRoleSchema,
});

export type ChangeWorkspaceMembershipRoleRequestV1 = z.infer<
  typeof changeWorkspaceMembershipRoleRequestSchema
>;

export const transferWorkspaceOwnershipRequestSchema = z.object({
  toUserId: z.string().min(1),
  demotedRole: manageableRoleSchema.optional(),
});

export type TransferWorkspaceOwnershipRequestV1 = z.infer<
  typeof transferWorkspaceOwnershipRequestSchema
>;

export function isManageableHumanWorkspaceRole(
  role: HumanWorkspaceRole,
): role is ManageableHumanWorkspaceRole {
  return (
    MANAGEABLE_HUMAN_WORKSPACE_ROLES as readonly HumanWorkspaceRole[]
  ).includes(role);
}
