import type { OfficeWorkerId, RoleId, TeamId } from "@osva/contracts";

import { DomainInvariantError } from "./errors.js";

export interface TeamMembershipProps {
  readonly teamId: TeamId;
  readonly officeWorkerId: OfficeWorkerId;
  readonly roleId?: RoleId;
}

export class TeamMembership {
  readonly teamId: TeamId;
  readonly officeWorkerId: OfficeWorkerId;
  readonly roleId: RoleId | undefined;

  private constructor(props: TeamMembershipProps) {
    this.teamId = props.teamId;
    this.officeWorkerId = props.officeWorkerId;
    this.roleId = props.roleId;
  }

  static create(props: TeamMembershipProps): TeamMembership {
    if (!props.teamId) {
      throw new DomainInvariantError("TeamMembership.teamId is required.");
    }

    if (!props.officeWorkerId) {
      throw new DomainInvariantError(
        "TeamMembership.officeWorkerId is required.",
      );
    }

    return Object.freeze(
      new TeamMembership({
        teamId: props.teamId,
        officeWorkerId: props.officeWorkerId,
        roleId: props.roleId,
      }),
    );
  }
}
