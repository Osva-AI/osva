import {
  HUMAN_WORKSPACE_ROLES,
  type HumanWorkspaceRole,
} from "@osva-ai/contracts";

import {
  roleCanExecuteControlPlaneActions,
  roleCanManageMembers,
  roleCanReadAuditEvents,
  roleCanTransferOwnership,
  roleCanWriteControlPlaneResources,
} from "./permissions.js";

/** Canonical Console mutation / admin controls for RBAC matrix tests. */
export const CONSOLE_MUTATION_CONTROL_IDS = {
  AGENT_REGISTER: "agent_register",
  AGENT_CREATE_VERSION: "agent_create_version",
  AGENT_LAUNCH_RUN: "agent_launch_run",
  WORKFLOW_CREATE: "workflow_create",
  WORKFLOW_CREATE_VERSION: "workflow_create_version",
  WORKFLOW_LAUNCH_RUN: "workflow_launch_run",
  WORKFLOW_APPROVAL_DECISION: "workflow_approval_decision",
  WORKFLOW_EVENT_EMIT: "workflow_event_emit",
  MEMBER_PROVISION: "member_provision",
  MEMBER_CHANGE_ROLE: "member_change_role",
  MEMBER_REMOVE: "member_remove",
  MEMBER_GRANT_OWNER: "member_grant_owner",
  OWNERSHIP_TRANSFER: "ownership_transfer",
  NAV_WORKSPACE_ACCESS: "nav_workspace_access",
  NAV_SECURITY_ACTIVITY: "nav_security_activity",
} as const;

export type ConsoleMutationControlId =
  (typeof CONSOLE_MUTATION_CONTROL_IDS)[keyof typeof CONSOLE_MUTATION_CONTROL_IDS];

export interface ConsoleMutationControlSpec {
  readonly id: ConsoleMutationControlId;
  readonly label: string;
  readonly visibleForRole: (role: HumanWorkspaceRole) => boolean;
}

export const CONSOLE_MUTATION_CONTROLS: readonly ConsoleMutationControlSpec[] =
  [
    {
      id: CONSOLE_MUTATION_CONTROL_IDS.AGENT_REGISTER,
      label: "Register Agent",
      visibleForRole: roleCanWriteControlPlaneResources,
    },
    {
      id: CONSOLE_MUTATION_CONTROL_IDS.AGENT_CREATE_VERSION,
      label: "Create agent version",
      visibleForRole: roleCanWriteControlPlaneResources,
    },
    {
      id: CONSOLE_MUTATION_CONTROL_IDS.AGENT_LAUNCH_RUN,
      label: "Launch agent run",
      visibleForRole: roleCanExecuteControlPlaneActions,
    },
    {
      id: CONSOLE_MUTATION_CONTROL_IDS.WORKFLOW_CREATE,
      label: "Create workflow",
      visibleForRole: roleCanWriteControlPlaneResources,
    },
    {
      id: CONSOLE_MUTATION_CONTROL_IDS.WORKFLOW_CREATE_VERSION,
      label: "Publish workflow version",
      visibleForRole: roleCanWriteControlPlaneResources,
    },
    {
      id: CONSOLE_MUTATION_CONTROL_IDS.WORKFLOW_LAUNCH_RUN,
      label: "Launch workflow run",
      visibleForRole: roleCanExecuteControlPlaneActions,
    },
    {
      id: CONSOLE_MUTATION_CONTROL_IDS.WORKFLOW_APPROVAL_DECISION,
      label: "Workflow approval decision",
      visibleForRole: roleCanExecuteControlPlaneActions,
    },
    {
      id: CONSOLE_MUTATION_CONTROL_IDS.WORKFLOW_EVENT_EMIT,
      label: "Workflow event emit",
      visibleForRole: roleCanExecuteControlPlaneActions,
    },
    {
      id: CONSOLE_MUTATION_CONTROL_IDS.MEMBER_PROVISION,
      label: "Provision workspace member",
      visibleForRole: roleCanManageMembers,
    },
    {
      id: CONSOLE_MUTATION_CONTROL_IDS.MEMBER_CHANGE_ROLE,
      label: "Change member role",
      visibleForRole: roleCanManageMembers,
    },
    {
      id: CONSOLE_MUTATION_CONTROL_IDS.MEMBER_REMOVE,
      label: "Remove member",
      visibleForRole: roleCanManageMembers,
    },
    {
      id: CONSOLE_MUTATION_CONTROL_IDS.MEMBER_GRANT_OWNER,
      label: "Grant owner",
      visibleForRole: roleCanTransferOwnership,
    },
    {
      id: CONSOLE_MUTATION_CONTROL_IDS.OWNERSHIP_TRANSFER,
      label: "Transfer ownership",
      visibleForRole: roleCanTransferOwnership,
    },
    {
      id: CONSOLE_MUTATION_CONTROL_IDS.NAV_WORKSPACE_ACCESS,
      label: "Workspace access nav",
      visibleForRole: roleCanManageMembers,
    },
    {
      id: CONSOLE_MUTATION_CONTROL_IDS.NAV_SECURITY_ACTIVITY,
      label: "Security activity nav",
      visibleForRole: roleCanReadAuditEvents,
    },
  ];

export const ALL_HUMAN_WORKSPACE_ROLES: readonly HumanWorkspaceRole[] =
  Object.values(HUMAN_WORKSPACE_ROLES);
