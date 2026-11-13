import {
  indexTeamMembershipsByWorkerId,
  type OfficeExecutionRoleRecord,
  type OfficeExecutionTeamMembershipRecord,
  type OfficeExecutionTeamRecord,
} from "@osva/domain/office-execution-context";

import type {
  OfficeRoleResource,
  OfficeTeamResource,
  TeamMembershipResource,
} from "../hooks/use-office";
import type { OfficeWorkerId, WorkspaceId } from "@osva-ai/contracts";

export function toOfficeExecutionTeamRecord(
  team: OfficeTeamResource,
): OfficeExecutionTeamRecord {
  return {
    id: team.id,
    workspaceId: team.workspaceId as WorkspaceId,
    name: team.name,
  };
}

export function toOfficeExecutionRoleRecord(
  role: OfficeRoleResource,
): OfficeExecutionRoleRecord {
  return {
    id: role.id,
    name: role.name,
  };
}

export function flattenTeamMemberships(
  teamIds: readonly string[],
  membershipLists: readonly {
    readonly items: readonly TeamMembershipResource[];
  }[],
): OfficeExecutionTeamMembershipRecord[] {
  const rows: OfficeExecutionTeamMembershipRecord[] = [];
  for (let index = 0; index < teamIds.length; index += 1) {
    const teamId = teamIds[index]!;
    const list = membershipLists[index]?.items ?? [];
    for (const item of list) {
      rows.push({
        teamId,
        officeWorkerId: item.officeWorkerId as OfficeWorkerId,
        roleId: item.roleId,
      });
    }
  }
  return rows;
}

export function buildOfficeTeamContextIndexes(props: {
  readonly teams: readonly OfficeTeamResource[];
  readonly roles: readonly OfficeRoleResource[];
  readonly memberships: readonly OfficeExecutionTeamMembershipRecord[];
}) {
  const teamsById = new Map<string, OfficeExecutionTeamRecord>();
  for (const team of props.teams) {
    teamsById.set(team.id, toOfficeExecutionTeamRecord(team));
  }
  const rolesById = new Map<string, OfficeExecutionRoleRecord>();
  for (const role of props.roles) {
    rolesById.set(role.id, toOfficeExecutionRoleRecord(role));
  }
  return {
    teamsById,
    rolesById,
    membershipsByWorkerId: indexTeamMembershipsByWorkerId(props.memberships),
  };
}
